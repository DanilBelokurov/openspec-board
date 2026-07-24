# Build code knowledge graph for the repository

Your task: build (or incrementally update) the code knowledge graph
for the freshly-cloned repository at `{repoPath}` and write a short
build summary to stderr.

The sdd-board UI considers the graph "built" only after the matching
`mcp__code-review-graph__get_architecture_overview_tool` call also
succeeds — so do both, in this exact order.

## Steps

1. Call `mcp__code-review-graph__build_or_update_graph_tool`:
   - `repo_root`: `{repoPath}` (absolute path to the repo)
   - `postprocess`: `"full"`
   - `full_rebuild`: `false` (incremental; the first call on a
     fresh repo will index everything anyway)

2. Wait for it to return. The response summarises what was
   indexed (node count, edge count, communities detected, language
   stats). Print a one-line summary to stderr:
   ```
   build: <N> nodes, <M> edges, <K> communities
   ```

3. Call `mcp__code-review-graph__get_architecture_overview_tool`:
   - `repo_root`: `{repoPath}`
   - `detail_level`: `"standard"`

4. Wait for it to return. The tool emits a JSON with the community
   structure and cross-community edges. Print a one-line summary
   to stderr:
   ```
   overview: <community-count> communities, <edge-count> cross-community edges
   ```

## What you must NOT do

- Do NOT modify any source files in `{repoPath}`.
- Do NOT call `mcp__code-review-graph__*refactor*` tools — this
  is a build, not a refactor.
- Do NOT call `generate_wiki_tool` — the sdd-board pipeline
  doesn't use the wiki.
- Do NOT read the result with `git show` / `cat` — the tools
  return what you need.

## Failure modes

- **Tool returns an error** — log the error verbatim to stderr,
  return a non-zero exit code via the shell `exit 1` so the
  sdd-board watcher can see the build failed.
- **`build_or_update_graph_tool` succeeds but
  `get_architecture_overview_tool` fails** — treat the build as
  failed (the sdd-board only marks the graph as "built" when
  both calls succeed; same for the build/visualize exit code
  pair).

## Context

- Repository: `{repoName}`
- Absolute repo path: `{repoPath}`
- Graph data dir: `{dataDir}`
- The graph database is auto-created by the tool at
  `{dataDir}/` (SQLite + a per-language symbol table).
