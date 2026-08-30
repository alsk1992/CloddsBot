//! Race a signed raw transaction across multiple RPC endpoints and return whichever
//! accepts it first.
//!
//! This is the whole technique: `eth_sendRawTransaction` the identical signed bytes to
//! every endpoint in parallel, take the first success, ignore the rest. Submitting the
//! same signed transaction to multiple nodes is safe — they relay the same transaction
//! hash, which only ever executes once on-chain no matter how many endpoints accepted
//! it. No nonce management, no pre-signing pipeline, no calibration: just parallel
//! submission instead of sequential single-endpoint submission.

use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use std::time::{Duration, Instant};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastRaceResult {
    pub hash: String,
    /// RPC URL that responded first.
    pub won_by: String,
    pub latency_ms: u128,
    pub endpoint_count: usize,
}

#[derive(Debug)]
pub struct BroadcastRaceError {
    pub endpoint_count: usize,
    pub errors: Vec<String>,
}

impl std::fmt::Display for BroadcastRaceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "all {} endpoints failed: {}",
            self.endpoint_count,
            self.errors.join("; ")
        )
    }
}
impl std::error::Error for BroadcastRaceError {}

/// keccak256 of the raw signed transaction bytes, as `0x`-prefixed hex. This is an
/// Ethereum transaction's hash by definition (independent of which node accepted it),
/// so it's used whenever a node reports "already known" without echoing the hash back.
pub fn tx_hash(raw_tx_hex: &str) -> String {
    let bytes = hex::decode(raw_tx_hex.trim_start_matches("0x")).unwrap_or_default();
    let digest = Keccak256::digest(&bytes);
    format!("0x{}", hex::encode(digest))
}

#[derive(Deserialize)]
struct RpcResponse {
    result: Option<String>,
    error: Option<RpcError>,
}

#[derive(Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

async fn send_raw_transaction(
    client: &reqwest::Client,
    rpc_url: &str,
    raw_tx_hex: &str,
    timeout: Duration,
) -> Result<String, String> {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_sendRawTransaction",
        "params": [raw_tx_hex],
    });

    let response = client
        .post(rpc_url)
        .json(&body)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| format!("{rpc_url}: {e}"))?;

    let parsed: RpcResponse = response
        .json()
        .await
        .map_err(|e| format!("{rpc_url}: bad response body: {e}"))?;

    if let Some(err) = parsed.error {
        let lower = err.message.to_lowercase();
        if lower.contains("already known") || lower.contains("already exists") {
            // Some other endpoint already accepted this exact tx — that's a win, not a failure.
            return Ok(tx_hash(raw_tx_hex));
        }
        return Err(format!("{rpc_url}: {} (code {})", err.message, err.code));
    }

    parsed
        .result
        .ok_or_else(|| format!("{rpc_url}: empty result"))
}

/// Submit `raw_tx_hex` to every URL in `rpc_urls` concurrently. Resolves with the first
/// endpoint to accept it; errors only if every endpoint fails.
pub async fn broadcast_race(
    raw_tx_hex: &str,
    rpc_urls: &[String],
    timeout: Duration,
) -> Result<BroadcastRaceResult, BroadcastRaceError> {
    if rpc_urls.is_empty() {
        return Err(BroadcastRaceError {
            endpoint_count: 0,
            errors: vec!["no RPC URLs provided".to_string()],
        });
    }

    let unique_urls: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        rpc_urls
            .iter()
            .filter(|u| seen.insert((*u).clone()))
            .cloned()
            .collect()
    };

    let client = reqwest::Client::new();
    let started_at = Instant::now();

    let mut tasks = tokio::task::JoinSet::new();
    for url in unique_urls.iter().cloned() {
        let client = client.clone();
        let raw_tx = raw_tx_hex.to_string();
        tasks.spawn(async move {
            let result = send_raw_transaction(&client, &url, &raw_tx, timeout).await;
            (url, result)
        });
    }

    let mut errors = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        let (url, result) = match joined {
            Ok(v) => v,
            Err(e) => {
                errors.push(format!("join error: {e}"));
                continue;
            }
        };
        match result {
            Ok(hash) => {
                return Ok(BroadcastRaceResult {
                    hash,
                    won_by: url,
                    latency_ms: started_at.elapsed().as_millis(),
                    endpoint_count: unique_urls.len(),
                });
            }
            Err(e) => errors.push(e),
        }
    }

    Err(BroadcastRaceError {
        endpoint_count: unique_urls.len(),
        errors,
    })
}
