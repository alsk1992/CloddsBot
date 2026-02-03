/**
 * QMD CLI Skill - Quick Markdown Search
 *
 * Commands:
 * /qmd search <query> - BM25 keyword search (fast, default)
 * /qmd vsearch <query> - Vector semantic search (slower)
 * /qmd query <query> - Hybrid search (best quality, slowest)
 * /qmd index <path> - Index a directory
 * /qmd collections - List indexed collections
 */

import { execSync } from 'child_process';

function checkQmd(): string | null {
  try {
    execSync('which qmd', { stdio: 'pipe' });
    return null;
  } catch {
    return `**qmd is not installed**

Install with:
\`\`\`bash
bun install -g https://github.com/tobi/qmd
\`\`\`

Or via cargo:
\`\`\`bash
cargo install qmd
\`\`\`

qmd provides fast BM25 keyword and vector semantic search over markdown files.`;
  }
}

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  const installError = checkQmd();
  if (installError) return installError;

  try {
    switch (cmd) {
      case 'search':
      case 's': {
        const query = parts.slice(1).join(' ');
        if (!query) return 'Usage: /qmd search <query>';
        const result = execSync(`qmd search "${query.replace(/"/g, '\\"')}"`, {
          encoding: 'utf-8',
          timeout: 10000,
        });
        return result || 'No results found.';
      }

      case 'vsearch':
      case 'vs': {
        const query = parts.slice(1).join(' ');
        if (!query) return 'Usage: /qmd vsearch <query>';
        const result = execSync(`qmd vsearch "${query.replace(/"/g, '\\"')}"`, {
          encoding: 'utf-8',
          timeout: 30000,
        });
        return result || 'No results found.';
      }

      case 'query':
      case 'q': {
        const query = parts.slice(1).join(' ');
        if (!query) return 'Usage: /qmd query <query>';
        const result = execSync(`qmd query "${query.replace(/"/g, '\\"')}"`, {
          encoding: 'utf-8',
          timeout: 60000,
        });
        return result || 'No results found.';
      }

      case 'index': {
        const path = parts[1];
        if (!path) return 'Usage: /qmd index <directory-path>';
        const result = execSync(`qmd index "${path.replace(/"/g, '\\"')}"`, {
          encoding: 'utf-8',
          timeout: 120000,
        });
        return result || 'Indexing complete.';
      }

      case 'collections':
      case 'list': {
        const result = execSync('qmd collections', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        return result || 'No collections indexed.';
      }

      default:
        return `**QMD - Quick Markdown Search**

  /qmd search <query>               - BM25 keyword search (fast)
  /qmd vsearch <query>              - Vector semantic search
  /qmd query <query>                - Hybrid search (best quality)
  /qmd index <path>                 - Index a directory
  /qmd collections                  - List indexed collections

Prefer 'search' for speed. Use 'vsearch' when keywords fail.`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export default {
  name: 'qmd',
  description: 'Quick Markdown search - BM25 keyword and vector semantic search',
  commands: ['/qmd'],
  handle: execute,
};
