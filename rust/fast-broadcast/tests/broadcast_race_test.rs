use fast_broadcast::{broadcast_race, tx_hash};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Behavior for one mock RPC endpoint in a test.
enum MockBehavior {
    /// Wait `delay`, then respond with a JSON-RPC success result.
    Success { delay: Duration, result: &'static str },
    /// Wait `delay`, then respond with a JSON-RPC error.
    Error { delay: Duration, message: &'static str },
    /// Accept the TCP connection but never respond (simulates a hung/dead endpoint
    /// past the client timeout).
    Hang,
}

/// Spins up a minimal one-shot HTTP server on localhost that returns a canned
/// JSON-RPC response, and returns its URL. Good enough to exercise real HTTP
/// round-trips without pulling in a mocking framework for a crate this small.
async fn mock_rpc(behavior: MockBehavior) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        let (mut socket, _) = match listener.accept().await {
            Ok(v) => v,
            Err(_) => return,
        };

        // Drain the request (headers + body) — content doesn't matter for these tests.
        let mut buf = [0u8; 4096];
        let _ = socket.read(&mut buf).await;

        match behavior {
            MockBehavior::Hang => {
                // Hold the connection open without ever writing a response.
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
            MockBehavior::Success { delay, result } => {
                tokio::time::sleep(delay).await;
                let body = format!(r#"{{"jsonrpc":"2.0","id":1,"result":"{result}"}}"#);
                write_response(&mut socket, &body).await;
            }
            MockBehavior::Error { delay, message } => {
                tokio::time::sleep(delay).await;
                let body =
                    format!(r#"{{"jsonrpc":"2.0","id":1,"error":{{"code":-32000,"message":"{message}"}}}}"#);
                write_response(&mut socket, &body).await;
            }
        }
    });

    format!("http://{addr}")
}

async fn write_response(socket: &mut tokio::net::TcpStream, json_body: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        json_body.len(),
        json_body
    );
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.shutdown().await;
}

#[tokio::test]
async fn wins_with_the_fastest_endpoint() {
    let fast = mock_rpc(MockBehavior::Success {
        delay: Duration::from_millis(10),
        result: "0xfast000000000000000000000000000000000000000000000000000000000",
    })
    .await;
    let slow = mock_rpc(MockBehavior::Success {
        delay: Duration::from_millis(300),
        result: "0xslow000000000000000000000000000000000000000000000000000000000",
    })
    .await;

    let result = broadcast_race("0xdeadbeef", &[fast.clone(), slow], Duration::from_secs(2))
        .await
        .expect("race should succeed");

    assert_eq!(result.hash, "0xfast000000000000000000000000000000000000000000000000000000000");
    assert_eq!(result.won_by, fast);
    assert_eq!(result.endpoint_count, 2);
}

#[tokio::test]
async fn a_slow_or_hung_loser_does_not_block_the_result() {
    let fast = mock_rpc(MockBehavior::Success {
        delay: Duration::from_millis(5),
        result: "0xwinner0000000000000000000000000000000000000000000000000000000",
    })
    .await;
    let hung = mock_rpc(MockBehavior::Hang).await;

    let started = std::time::Instant::now();
    let result = broadcast_race("0xdeadbeef", &[fast, hung], Duration::from_secs(5))
        .await
        .expect("race should succeed despite a hung endpoint");

    assert_eq!(result.hash, "0xwinner0000000000000000000000000000000000000000000000000000000");
    // Must resolve on the fast winner's timeline, not wait anywhere near the hung
    // endpoint's 5s client timeout.
    assert!(started.elapsed() < Duration::from_millis(500));
}

#[tokio::test]
async fn errors_only_when_every_endpoint_fails() {
    let a = mock_rpc(MockBehavior::Error {
        delay: Duration::from_millis(5),
        message: "insufficient funds",
    })
    .await;
    let b = mock_rpc(MockBehavior::Error {
        delay: Duration::from_millis(5),
        message: "gas too low",
    })
    .await;

    let err = broadcast_race("0xdeadbeef", &[a, b], Duration::from_secs(2))
        .await
        .expect_err("all endpoints failing must be an error");

    assert_eq!(err.endpoint_count, 2);
    assert_eq!(err.errors.len(), 2);
}

#[tokio::test]
async fn treats_already_known_as_a_win_using_the_local_tx_hash() {
    let url = mock_rpc(MockBehavior::Error {
        delay: Duration::from_millis(5),
        message: "already known",
    })
    .await;

    let raw_tx = "0xdeadbeefcafe";
    let result = broadcast_race(raw_tx, &[url], Duration::from_secs(2))
        .await
        .expect("'already known' must be treated as success, not failure");

    assert_eq!(result.hash, tx_hash(raw_tx));
}

#[tokio::test]
async fn deduplicates_repeated_urls_before_racing() {
    let url = mock_rpc(MockBehavior::Success {
        delay: Duration::from_millis(5),
        result: "0xonly0000000000000000000000000000000000000000000000000000000000",
    })
    .await;

    let result = broadcast_race("0xdeadbeef", &[url.clone(), url], Duration::from_secs(2))
        .await
        .expect("race should succeed");

    assert_eq!(result.endpoint_count, 1);
}

#[tokio::test]
async fn empty_endpoint_list_is_an_error() {
    let err = broadcast_race("0xdeadbeef", &[], Duration::from_secs(1))
        .await
        .expect_err("empty endpoint list must error, not hang or panic");
    assert_eq!(err.endpoint_count, 0);
}

#[test]
fn tx_hash_is_deterministic_and_well_formed() {
    let a = tx_hash("0x1234abcd");
    let b = tx_hash("0x1234abcd");
    assert_eq!(a, b);
    assert!(a.starts_with("0x"));
    assert_eq!(a.len(), 66, "keccak256 hash must be 0x + 64 hex chars");

    let different = tx_hash("0xffff0000");
    assert_ne!(a, different);
}
