#!/usr/bin/env node
/**
 * @coral-xyz/anchor's CJS build exposes `BN` via a getter-only accessor:
 *   Object.defineProperty(exports, "BN", { enumerable: true, get: () => ... })
 * Anchor's package.json has no "exports" map, so Node's native ESM resolver
 * (used when a pure-ESM package like @meteora-ag/dlmm does a native
 * `import { BN } from "@coral-xyz/anchor"`) falls back to "main" (the CJS
 * build) and synthesizes named bindings from it. That synthesis does not
 * pick up this getter-based BN, so any strictly-ESM consumer fails with
 * "does not provide an export named 'BN'" — even though `anchor.BN` works
 * fine everywhere else (CJS require(), or code transformed by tsx/esbuild,
 * both of which do runtime property access instead of static analysis).
 *
 * Verified live: this breaks @meteora-ag/dlmm's getMeteoraDlmmQuote and
 * listMeteoraDlmmPools completely. Fix: rewrite the getter into a plain
 * static assignment, which every CJS/ESM interop path detects correctly.
 * There can be several copies of @coral-xyz/anchor nested under different
 * dependencies (different consumers pin different anchor versions) — patch
 * all of them, not just the top-level one. Idempotent; never fails install.
 */
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const GETTER_PATTERN =
  'Object.defineProperty(exports, "BN", { enumerable: true, get: function () { return __importDefault(bn_js_1).default; } });';
const PLAIN_ASSIGNMENT = 'exports.BN = __importDefault(bn_js_1).default;';

function findAnchorCjsFiles() {
  try {
    const root = path.join(__dirname, '..');
    const output = execSync(
      'find node_modules -path "*/@coral-xyz/anchor/dist/cjs/index.js" 2>/dev/null',
      { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => path.join(root, line));
  } catch {
    return [];
  }
}

function main() {
  let patched = 0;
  for (const file of findAnchorCjsFiles()) {
    try {
      if (!existsSync(file)) continue;
      const content = readFileSync(file, 'utf8');
      if (!content.includes(GETTER_PATTERN)) continue; // already patched, or a build we don't recognize
      writeFileSync(file, content.replace(GETTER_PATTERN, PLAIN_ASSIGNMENT));
      patched += 1;
    } catch {
      // Never fail install over this.
    }
  }
  if (patched > 0) {
    console.log(`[fix-anchor-bn-export] patched ${patched} @coral-xyz/anchor build(s) so BN resolves under native ESM import.`);
  }
}

main();
