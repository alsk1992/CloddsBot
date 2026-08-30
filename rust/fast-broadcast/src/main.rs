//! CLI entry point: reads a broadcast request as JSON on stdin, writes the result as
//! JSON on stdout. This is the narrow interface the TypeScript control plane talks to
//! — spawn this binary, write one line of JSON, read one line of JSON back.
//!
//! Input:  {"rawTx": "0x...", "rpcUrls": ["https://...", "https://..."], "timeoutMs": 5000}
//! Output: {"ok": true, "hash": "0x...", "wonBy": "https://...", "latencyMs": 42, "endpointCount": 3}
//!      or {"ok": false, "error": "...", "endpointCount": 3}

use fast_broadcast::broadcast_race;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    raw_tx: String,
    rpc_urls: Vec<String>,
    #[serde(default = "default_timeout_ms")]
    timeout_ms: u64,
}

fn default_timeout_ms() -> u64 {
    5_000
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response {
    #[serde(rename_all = "camelCase")]
    Ok {
        ok: bool,
        hash: String,
        won_by: String,
        latency_ms: u128,
        endpoint_count: usize,
    },
    #[serde(rename_all = "camelCase")]
    Err {
        ok: bool,
        error: String,
        endpoint_count: usize,
    },
}

#[tokio::main]
async fn main() {
    let mut input = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("failed to read stdin: {e}");
        std::process::exit(1);
    }

    let request: Request = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => {
            println!(
                "{}",
                serde_json::to_string(&Response::Err {
                    ok: false,
                    error: format!("invalid request JSON: {e}"),
                    endpoint_count: 0,
                })
                .unwrap()
            );
            std::process::exit(1);
        }
    };

    let timeout = Duration::from_millis(request.timeout_ms);
    let response = match broadcast_race(&request.raw_tx, &request.rpc_urls, timeout).await {
        Ok(result) => Response::Ok {
            ok: true,
            hash: result.hash,
            won_by: result.won_by,
            latency_ms: result.latency_ms,
            endpoint_count: result.endpoint_count,
        },
        Err(e) => Response::Err {
            ok: false,
            error: e.to_string(),
            endpoint_count: e.endpoint_count,
        },
    };

    let is_ok = matches!(response, Response::Ok { .. });
    println!("{}", serde_json::to_string(&response).unwrap());
    if !is_ok {
        std::process::exit(1);
    }
}
