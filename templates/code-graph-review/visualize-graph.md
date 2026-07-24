Re-emit the code-review-graph as a single JSON document on stdout.

Steps:
1. Call `mcp__code-review-graph__get_architecture_overview_tool` with `repo_root`: `{repoPath}`, `detail_level`: `"standard"`.
2. Wrap the tool's response in a single JSON object on stdout:
   ```json
   {"repo": "{repoName}", "repoRoot": "{repoPath}", "dataDir": "{dataDir}", "generatedAt": "<ISO-8601>", "overview": <tool response verbatim>}
   ```

Do NOT modify any source files. Do NOT call any other tool.
