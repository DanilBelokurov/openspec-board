# Apply the "sdd" label to a Jira issue

## Context
- Jira issue: `{jiraKey}`
- Analyst comments: `{comments}`

## Steps

1. Apply the label `"sdd"` to `{jiraKey}` by calling the MCP tool
   `mcp__jira-mcp__add_labels`:

   ```
   mcp__jira-mcp__add_labels({
     issue_key: "{jiraKey}",
     labels:    ["sdd"],
   })
   ```

2. In your final response, report either:
   - `label "sdd" applied to {jiraKey}` on success, or
   - the MCP error verbatim on failure (do not fall back to REST
     or `curl`).

## Constraints
- Don't add any labels other than `"sdd"`.
- Don't modify the change-proposal files — they were already
  approved by the analyst.
- Don't fall back to the `gh` CLI, REST API, or a hand-rolled HTTP
  request on MCP failure — surface the MCP error verbatim and
  stop. Falling back masks configuration drift between sdd-board
  and the host environment.
