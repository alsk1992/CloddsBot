#!/usr/bin/env node
/**
 * bigint-buffer (pulled in transitively by @solana/buffer-layout-utils, which
 * nearly every Solana SDK depends on) ships a prebuilt native binary per
 * platform. On some hosts that binary is subtly incompatible with the actual
 * CPU/runtime (observed: SIGILL on process exit after a successful import,
 * on linux-x64-gnu under WSL2) even though the exact same JS-level API works
 * fine. bigint-buffer already has a pure-JS fallback for exactly this case —
 * it just doesn't know to use it here, because the native binary "loads" and
 * only fails later.
 *
 * This empirically tests the native binary for the current platform in an
 * isolated child process. If that child crashes, the binary is renamed so
 * bigint-buffer's own existsSync() check fails and it falls through to the
 * pure-JS implementation. Safe to run repeatedly; never throws (a postinstall
 * step failing must never break `npm install`).
 */
const { existsSync, renameSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

function nativeModuleName() {
  const map = {
    'darwin-x64': 'darwin-x64',
    'darwin-arm64': 'darwin-arm64',
    'linux-x64': 'linux-x64-gnu',
    'linux-arm64': 'linux-arm64-gnu',
    'win32-x64': 'win32-x64-msvc',
  };
  const key = `${process.platform}-${process.arch}`;
  return map[key] || key;
}

function main() {
  try {
    const dir = join(__dirname, '..', 'node_modules', 'bigint-buffer');
    const nativeFile = join(dir, `index.${nativeModuleName()}.node`);
    if (!existsSync(nativeFile)) return; // nothing to test/disable

    const probe = `
      try {
        const b = require(${JSON.stringify(nativeFile)});
        b.toBigintLe(Buffer.from([1, 2, 3, 4]));
        process.exit(0);
      } catch {
        process.exit(0); // a normal JS error is fine — we only care about crashes
      }
    `;
    const result = spawnSync(process.execPath, ['-e', probe], { timeout: 10_000 });

    const crashed = result.signal !== null || (typeof result.status === 'number' && result.status > 128);
    if (crashed) {
      renameSync(nativeFile, `${nativeFile}.disabled-incompatible`);
      console.log(
        `[fix-native-bindings] bigint-buffer native binary crashed on this host (signal=${result.signal}); disabled it — falling back to the pure-JS implementation.`
      );
    }
  } catch {
    // Never fail install over this.
  }
}

main();
