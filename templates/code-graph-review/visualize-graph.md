# Re-emit the code-review-graph as a single JSON document

The graph for the repository at `{repoPath}` was already built by
`mcp__code-review-graph__build_or_update_graph_tool`. The sdd-board
treats this step as a re-emission of the same architecture
overview, captured as JSON. Output a single JSON object on stdout
that the sdd-board log can persist.

## Steps

1. Call `mcp__code-review-graph__get_architecture_overview_tool`:
   - `repo_root`: `{repoPath}`
   - `detail_level`: `"standard"`

2. Wait for the response. The tool returns a JSON object with the
   community structure and the cross-community edges.

3. Wrap the response in a single JSON object printed to stdout, of
   the form:
   ```json
   {
     "repo": "{repoName}",
     "repoRoot": "{repoPath}",
     "dataDir": "{dataDir}",
     "generatedAt": "<ISO-8601 timestamp>",
     "overview": <the tool's response verbatim>
   }
   ```
   The `overview` field is the raw JSON object the tool returned
   (community list + edge list). `generatedAt` is the current time
   in ISO-8601.

4. Don't pretty-print the outer wrapper — keep the JSON compact
   so the sdd-board log file stays small. The `overview` field
   can be left as-is (the tool already returns compact JSON).

## Constraints

- Do NOT call any other tool. One tool call, one stdout write.
- Do NOT modify any source files.
- Do NOT read files from `{repoPath}` directly — the graph
  tool is the source of truth.
- Output MUST be a single JSON object on stdout — no preamble,
  no trailing text, no extra logs on stdout (use stderr for
  any progress messages).

## Failure modes

- **Tool returns an error** — log it to stderr and exit 1.
  The sdd-board watcher records the non-zero exit code on the
  repo's `visualizeExitCode` field, which routes to a red
  "Ошибка построения графа" toast.
