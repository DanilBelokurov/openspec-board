# Create a Pull Request for the recently pushed Stash branch

## Context
- Branch (head): `{branch}`
- Base branch: `{baseBranch}`
- Workspace / project key: `{workspace}`
- Repository slug: `{repoSlug}`
- Tag (change name): `{tag}`
- Repository remote: `{repoUrl}`
- Analyst comments: `{comments}`

## Source files to read
Read every file under `<worktree>/openspec/changes/{tag}/` so the PR title and body reflect the actual change:
- `proposal.md`
- `design.md` (if present)
- `adr.md` (if present)
- `specs/<capability>.md` (if present)

## Steps

1. Read the change-proposal files.
2. Compose an imperative PR title under 70 characters.
3. Compose a PR description under 512 characters with Summary and Why.
4. Open the PR by calling the Bitbucket MCP tool `mcp__bitbucket__create_pull_request`:
   ```
   mcp__bitbucket__create_pull_request({
     workspace: "{workspace}",
     repo_slug: "{repoSlug}",
     title: "<your title>",
     description: "<your description>",
     sourceBranch: "{branch}",
     targetBranch: "{baseBranch}"
   })
   ```
5. Report the created PR URL from the tool response in your final response.

## Constraints
- Do not modify the change-proposal files.
- Do not push, squash, rebase, or rewrite history.
- Do not call `mcp__sourcecontrol__git_create_pull_request` for this remote.
- Do not fall back to `gh`, REST, `curl`, or another tool if the Bitbucket MCP call fails; surface the MCP error verbatim and stop.
