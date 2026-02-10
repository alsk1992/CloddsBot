/**
 * Search Config CLI Skill
 *
 * Commands:
 * /search-config - Show search configuration
 * /search-config weights - Show vector/BM25 weights
 * /search-config set vector-weight <0-1> - Set vector weight
 * /search-config set bm25-weight <0-1> - Set BM25 weight
 * /search-config test <query> - Run a test BM25 keyword search
 */

// In-memory config state (applied when creating new search services)
let currentConfig = {
  vectorWeight: 0.5,
  bm25Weight: 0.5,
  minScore: 0.1,
};

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'show';

  try {
    // Verify the search module is importable
    const searchMod = await import('../../../search/index');

    switch (cmd) {
      case 'show':
      case '': {
        return `**Search Configuration**

Mode: hybrid (Vector + BM25)
Vector weight: ${currentConfig.vectorWeight}
BM25 weight: ${currentConfig.bm25Weight}
Min score threshold: ${currentConfig.minScore}
BM25 k1: 1.5 (term frequency saturation)
BM25 b: 0.75 (length normalization)

Available methods: \`bm25Search\`, \`createHybridSearchService\``;
      }

      case 'weights': {
        const total = currentConfig.vectorWeight + currentConfig.bm25Weight;
        const vectorPct = total > 0 ? Math.round((currentConfig.vectorWeight / total) * 100) : 50;
        const bm25Pct = total > 0 ? Math.round((currentConfig.bm25Weight / total) * 100) : 50;

        return `**Search Weights**

Vector (semantic): ${currentConfig.vectorWeight} (${vectorPct}%)
BM25 (keyword):    ${currentConfig.bm25Weight} (${bm25Pct}%)

Vector catches meaning similarities (e.g. "car" matches "automobile").
BM25 catches exact keyword matches (e.g. "TypeError" matches "TypeError").

Adjust with:
  /search-config set vector-weight <0-1>
  /search-config set bm25-weight <0-1>`;
      }

      case 'set': {
        const param = parts[1]?.toLowerCase();
        const value = parseFloat(parts[2]);

        if (isNaN(value) || value < 0 || value > 1) {
          return 'Value must be a number between 0 and 1.';
        }

        if (param === 'vector-weight') {
          currentConfig.vectorWeight = value;
          currentConfig.bm25Weight = parseFloat((1 - value).toFixed(2));
          return `Vector weight set to **${value}**. BM25 weight auto-adjusted to **${currentConfig.bm25Weight}**.\n\nNew searches will use these weights.`;
        }

        if (param === 'bm25-weight') {
          currentConfig.bm25Weight = value;
          currentConfig.vectorWeight = parseFloat((1 - value).toFixed(2));
          return `BM25 weight set to **${value}**. Vector weight auto-adjusted to **${currentConfig.vectorWeight}**.\n\nNew searches will use these weights.`;
        }

        if (param === 'min-score') {
          currentConfig.minScore = value;
          return `Min score threshold set to **${value}**. Results below this score will be filtered out.`;
        }

        return 'Usage: /search-config set <vector-weight|bm25-weight|min-score> <0-1>';
      }

      case 'test': {
        const query = parts.slice(1).join(' ');
        if (!query) {
          return 'Usage: /search-config test <query>\n\nRuns a BM25 keyword search against sample data to verify the search module is working.';
        }

        // Run a quick BM25 test search against sample documents
        const sampleDocs = [
          'TypeScript is a typed superset of JavaScript',
          'BM25 is a bag-of-words retrieval function',
          'Vector search uses embeddings for semantic similarity',
          'Hybrid search combines keyword and vector search',
          'The search config controls weight distribution',
        ];

        const results = searchMod.bm25Search(
          query,
          sampleDocs,
          (doc: string) => doc,
          5
        );

        if (results.length === 0) {
          return `**BM25 Test Search:** "${query}"\n\nNo results found.`;
        }

        let output = `**BM25 Test Search:** "${query}"\n\n`;
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.score > 0) {
            output += `${i + 1}. [${r.score.toFixed(3)}] ${r.item}\n`;
          }
        }
        return output;
      }

      case 'reset': {
        currentConfig = { vectorWeight: 0.5, bm25Weight: 0.5, minScore: 0.1 };
        return 'Search config reset to defaults (50/50 vector/BM25, 0.1 min score).';
      }

      case 'export': {
        const json = JSON.stringify(currentConfig, null, 2);
        return `**Current Config (JSON)**\n\n\`\`\`json\n${json}\n\`\`\`\n\nUse this with \`createHybridSearchService(embeddings, config)\`.`;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Search Config Commands**

  /search-config                           - Show configuration
  /search-config weights                   - Show search weights
  /search-config set vector-weight <v>     - Set vector search weight (0-1)
  /search-config set bm25-weight <v>       - Set BM25 keyword weight (0-1)
  /search-config set min-score <v>         - Set minimum score threshold
  /search-config test <query>              - Test BM25 keyword search
  /search-config reset                     - Reset to defaults
  /search-config export                    - Export config as JSON`;
}

export default {
  name: 'search-config',
  description: 'Configure hybrid search weights for vector and BM25 retrieval',
  commands: ['/search-config'],
  handle: execute,
};
