#!/usr/bin/env python3
"""
Lighter (zk-rollup perp/spot exchange) trading bridge.

Lighter's L2 transactions must be signed by a native binary the official SDK
loads via ctypes (compiled from github.com/elliottech/lighter-go) — there is
no published algorithm spec to reimplement in TypeScript, and even Lighter's
own official AI-agent integration (elliottech/lighter-agent-kit) works this
same way: Python calling the official SDK, not a from-scratch reimplementation
in the host language. This script is that same bridge for CloddsBot: invoked
as a subprocess from src/exchanges/lighter/index.ts, one JSON object in on
stdin, one JSON object out on stdout, mirroring the existing Rust
fast-broadcast subprocess pattern (src/evm/fast-broadcast.ts) so the two
"call out to a real, verified implementation" paths in this codebase look and
behave the same way.

Bootstrapping mirrors elliottech/lighter-agent-kit's own approach: lazy
pip-install into a local .vendor/pyX.Y/ dir on first use, so nothing needs a
pre-existing venv or global install.

Input (stdin, one JSON object):
  {
    "action": "place_market_order" | "place_limit_order" | "cancel_order" |
              "cancel_all_orders" | "get_account" | "get_open_orders",
    "url": "https://mainnet.zklighter.elliot.ai",
    "account_index": 41,
    "api_key_index": 0,
    "api_private_key": "0x...",
    ...action-specific params (see each handler below)
  }

Output (stdout, one JSON object): either the action's result, or
{"error": "..."} on failure (exit code 1). Never raises a raw traceback —
every failure path is caught and reported as a JSON error object so the
Node side never has to parse Python stack traces.
"""

import json
import os
import subprocess
import sys
import warnings

warnings.filterwarnings("ignore")

_BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
_PY_TAG = f"py{sys.version_info.major}.{sys.version_info.minor}"
_VENDOR_DIR = os.path.join(_BRIDGE_DIR, ".vendor", _PY_TAG)
_LOCKFILE = os.path.join(_BRIDGE_DIR, "requirements.lock")


def _fail(message, **extra):
    print(json.dumps({"error": message, **extra}))
    sys.exit(1)


def _stub_eth_account():
    """lighter-sdk's signer_client.py imports eth_account at module load time
    purely for the ETH-key-based API-key-registration flow, which this bridge
    doesn't use (CloddsBot expects an already-provisioned L2 api_private_key —
    registering a new one is a separate, one-time setup step, not something a
    live trading call should ever need). Stubbing it out avoids pulling in
    eth_account's dependency tree for functionality this bridge never calls.
    """
    import types

    if "eth_account" in sys.modules:
        return
    mod = types.ModuleType("eth_account")
    mod.Account = None
    msgs = types.ModuleType("eth_account.messages")
    msgs.encode_defunct = None
    mod.messages = msgs
    sys.modules.setdefault("eth_account", mod)
    sys.modules.setdefault("eth_account.messages", msgs)


def _ensure_lighter():
    if sys.version_info < (3, 9):
        have = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        _fail(f"lighter-bridge requires Python 3.9+, found {have}")

    _stub_eth_account()
    if os.path.isdir(_VENDOR_DIR) and _VENDOR_DIR not in sys.path:
        sys.path.insert(0, _VENDOR_DIR)

    try:
        import lighter  # noqa: F401
        return
    except ImportError:
        pass

    if not os.path.isfile(_LOCKFILE):
        _fail("requirements.lock is missing from scripts/lighter-bridge/")

    os.makedirs(_VENDOR_DIR, exist_ok=True)
    try:
        subprocess.run(
            [
                sys.executable, "-m", "pip", "install",
                "--target", _VENDOR_DIR,
                "--quiet",
                "--disable-pip-version-check",
                "-r", _LOCKFILE,
            ],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or b"").decode(errors="replace").strip()[-800:]
        _fail("dependency install failed", detail=detail)

    if _VENDOR_DIR not in sys.path:
        sys.path.insert(0, _VENDOR_DIR)
    try:
        import lighter  # noqa: F401
    except ImportError as e:
        _fail("dependencies installed but still cannot import lighter", detail=str(e))


def _make_signer_client(lighter, req):
    return lighter.SignerClient(
        url=req["url"],
        account_index=int(req["account_index"]),
        api_private_keys={int(req["api_key_index"]): req["api_private_key"]},
    )


async def _place_market_order(lighter, req):
    client = _make_signer_client(lighter, req)
    try:
        err = client.check_client()
        if err is not None:
            return {"success": False, "error": str(err)}

        tx, tx_hash, err = await client.create_market_order(
            market_index=int(req["market_index"]),
            client_order_index=int(req.get("client_order_index", 0)),
            base_amount=int(req["base_amount"]),
            avg_execution_price=int(req["avg_execution_price"]),
            is_ask=bool(req["is_ask"]),
        )
        if err is not None:
            return {"success": False, "error": str(err)}
        return {"success": True, "txHash": tx_hash}
    finally:
        await client.close()


async def _place_limit_order(lighter, req):
    client = _make_signer_client(lighter, req)
    try:
        err = client.check_client()
        if err is not None:
            return {"success": False, "error": str(err)}

        api_key_index, nonce = client.nonce_manager.next_nonce()
        time_in_force = (
            client.ORDER_TIME_IN_FORCE_POST_ONLY if req.get("post_only")
            else client.ORDER_TIME_IN_FORCE_GOOD_TILL_TIME
        )
        tx, tx_hash, err = await client.create_order(
            market_index=int(req["market_index"]),
            client_order_index=int(req.get("client_order_index", 0)),
            base_amount=int(req["base_amount"]),
            price=int(req["price"]),
            is_ask=bool(req["is_ask"]),
            order_type=client.ORDER_TYPE_LIMIT,
            time_in_force=time_in_force,
            reduce_only=bool(req.get("reduce_only", False)),
            trigger_price=0,
            nonce=nonce,
            api_key_index=api_key_index,
        )
        if err is not None:
            return {"success": False, "error": str(err)}
        return {"success": True, "txHash": tx_hash}
    finally:
        await client.close()


async def _cancel_order(lighter, req):
    client = _make_signer_client(lighter, req)
    try:
        api_key_index, nonce = client.nonce_manager.next_nonce()
        tx, tx_hash, err = await client.cancel_order(
            market_index=int(req["market_index"]),
            order_index=int(req["order_index"]),
            nonce=nonce,
            api_key_index=api_key_index,
        )
        if err is not None:
            return {"success": False, "error": str(err)}
        return {"success": True, "txHash": tx_hash}
    finally:
        await client.close()


async def _cancel_all_orders(lighter, req):
    client = _make_signer_client(lighter, req)
    try:
        api_key_index, nonce = client.nonce_manager.next_nonce()
        market_index = req.get("market_index")
        kwargs = {
            "time_in_force": client.CANCEL_ALL_TIF_IMMEDIATE,
            "timestamp_ms": 0,
            "nonce": nonce,
            "api_key_index": api_key_index,
        }
        if market_index is not None:
            kwargs["cancel_all_market_index"] = int(market_index)
        tx, tx_hash, err = await client.cancel_all_orders(**kwargs)
        if err is not None:
            return {"success": False, "error": str(err)}
        return {"success": True, "txHash": tx_hash}
    finally:
        await client.close()


async def _get_account(lighter, req):
    client = _make_signer_client(lighter, req)
    try:
        account_api = lighter.AccountApi(client.api_client)
        resp = await account_api.account(
            by="index", value=str(int(req["account_index"]))
        )
        return {"success": True, "accounts": [a.to_dict() for a in resp.accounts]}
    finally:
        await client.close()


async def _get_open_orders(lighter, req):
    client = _make_signer_client(lighter, req)
    try:
        auth, err = client.create_auth_token_with_expiry(api_key_index=int(req["api_key_index"]))
        if err is not None:
            return {"success": False, "error": str(err)}

        order_api = lighter.OrderApi(client.api_client)
        market_id = req.get("market_index")
        resp = await order_api.account_active_orders(
            authorization=auth,
            account_index=int(req["account_index"]),
            market_id=int(market_id) if market_id is not None else None,
        )
        return {"success": True, "orders": [o.to_dict() for o in resp.orders]}
    finally:
        await client.close()


_HANDLERS = {
    "place_market_order": _place_market_order,
    "place_limit_order": _place_limit_order,
    "cancel_order": _cancel_order,
    "cancel_all_orders": _cancel_all_orders,
    "get_account": _get_account,
    "get_open_orders": _get_open_orders,
}


async def _main_async(req):
    _ensure_lighter()
    import lighter

    action = req.get("action")
    handler = _HANDLERS.get(action)
    if handler is None:
        _fail(f"unknown action '{action}', expected one of {sorted(_HANDLERS)}")

    for required in ("url", "account_index", "api_key_index", "api_private_key"):
        if required not in req:
            _fail(f"missing required field '{required}'")

    try:
        result = await handler(lighter, req)
    except Exception as e:  # noqa: BLE001 — every failure path must become JSON, never a raw traceback
        _fail(f"{type(e).__name__}: {e}")
        return

    print(json.dumps(result))


def main():
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        _fail(f"invalid JSON on stdin: {e}")
        return

    import asyncio
    asyncio.run(_main_async(req))


if __name__ == "__main__":
    main()
