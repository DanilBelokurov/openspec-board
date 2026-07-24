Build (or incrementally update) the code knowledge graph for the repository at `{repoPath}` and emit a one-line summary to stderr.

Steps:
1. Call `mcp__code-review-graph__build_or_update_graph_tool` with `repo_root`: `{repoPath}`. The data dir is fixed: `{dataDir}`.
2. Call `mcp__code-review-graph__get_architecture_overview_tool` with `repo_root`: `{repoPath}`, `detail_level`: `"standard"`.

Do NOT modify any source files. Do NOT call refactor or wiki tools.
