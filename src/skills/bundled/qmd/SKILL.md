---
name: qmd
description: "Search and retrieve local markdown notes and docs using BM25 keyword or semantic vector search. Use when searching notes, finding related content, or retrieving documents from indexed collections."
homepage: https://github.com/tobi/qmd
metadata: {"clawdbot":{"emoji":"🔍","os":["darwin","linux"],"requires":{"bins":["qmd"]},"install":[{"id":"bun-qmd","kind":"shell","command":"bun install -g https://github.com/tobi/qmd","bins":["qmd"],"label":"Install qmd via Bun"}]}}
---

# qmd - Quick Markdown Search

Local search engine for Markdown notes, docs, and knowledge bases. Index once, search fast.

## When to use (trigger phrases)

- "search my notes / docs / knowledge base"
- "find related notes"
- "retrieve a markdown document from my collection"
- "search local markdown files"

## Default behavior (important)

- Prefer `qmd search` (BM25). It's typically instant and should be the default.
- Use `qmd vsearch` only when keyword search fails and you need semantic similarity (can be very slow on a cold start).
- Avoid `qmd query` unless the user explicitly wants the highest quality hybrid results and can tolerate long runtimes/timeouts.

## Prerequisites

- Bun >= 1.0.0
- macOS: `brew install sqlite` (SQLite extensions)
- Ensure PATH includes: `$HOME/.bun/bin`

Install Bun (macOS): `brew install oven-sh/bun/bun`

## Install

`bun install -g https://github.com/tobi/qmd`

## Setup

```bash
qmd collection add /path/to/notes --name notes --mask "**/*.md"
qmd context add qmd://notes "Description of this collection"  # optional
qmd embed  # one-time to enable vector + hybrid search
```

## What it indexes

- Intended for Markdown collections (commonly `**/*.md`).
- In our testing, "messy" Markdown is fine: chunking is content-based (roughly a few hundred tokens per chunk), not strict heading/structure based.
- Not a replacement for code search; use code search tools for repositories/source trees.

## Search modes

- `qmd search` (default): fast keyword match (BM25)
- `qmd vsearch` (last resort): semantic similarity (vector). Often slow due to local LLM work before the vector lookup.
- `qmd query` (generally skip): hybrid search + LLM reranking. Often slower than `vsearch` and may timeout.

## Performance notes

- `qmd search` is typically instant.
- `qmd vsearch` can be ~1 minute on some machines because query expansion may load a local model (e.g., Qwen3-1.7B) into memory per run; the vector lookup itself is usually fast.
- `qmd query` adds LLM reranking on top of `vsearch`, so it can be even slower and less reliable for interactive use.
- If you need repeated semantic searches, consider keeping the process/model warm (e.g., a long-lived qmd/MCP server mode if available in your setup) rather than invoking a cold-start LLM each time.

## Common commands

```bash
qmd search "query"             # default
qmd vsearch "query"
qmd query "query"
qmd search "query" -c notes     # Search specific collection
qmd search "query" -n 10        # More results
qmd search "query" --json       # JSON output
qmd search "query" --all --files --min-score 0.3
```

## Useful options

- `-n <num>`: number of results
- `-c, --collection <name>`: restrict to a collection
- `--all --min-score <num>`: return all matches above a threshold
- `--json` / `--files`: agent-friendly output formats
- `--full`: return full document content

## Retrieve

```bash
qmd get "path/to/file.md"       # Full document
qmd get "#docid"                # By ID from search results
qmd multi-get "journals/2025-05*.md"
qmd multi-get "doc1.md, doc2.md, #abc123" --json
```

## Maintenance

```bash
qmd status                      # Index health
qmd update                      # Re-index changed files
qmd embed                       # Update embeddings
```

## Keeping the index fresh

Automate indexing so results stay current as you add/edit notes.

- For keyword search (`qmd search`), `qmd update` is usually enough (fast).
- If you rely on semantic/hybrid search (`vsearch`/`query`), you may also want `qmd embed`, but it can be slow.

Example schedules (cron):

```bash
# Hourly incremental updates (keeps BM25 fresh):
0 * * * * export PATH="$HOME/.bun/bin:$PATH" && qmd update

# Optional: nightly embedding refresh (can be slow):
0 5 * * * export PATH="$HOME/.bun/bin:$PATH" && qmd embed
```

If your Clawdbot/agent environment supports a built-in scheduler, you can run the same commands there instead of system cron.

## Models and cache

- Uses local GGUF models; first run auto-downloads them.
- Default cache: `~/.cache/qmd/models/` (override with `XDG_CACHE_HOME`).

## Relationship to Clawdbot memory search

- `qmd` searches *your local files* (notes/docs) that you explicitly index into collections.
- Clawdbot's `memory_search` searches *agent memory* (saved facts/context from prior interactions).
- Use both: `memory_search` for "what did we decide/learn before?", `qmd` for "what's in my notes/docs on disk?".
