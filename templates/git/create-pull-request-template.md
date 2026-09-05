# Create a Pull Request for the recently pushed branch

## Context
- Branch (head): `{branch}`
- Base branch: `{baseBranch}`
- Tag (change name): `{tag}`
- Repository: `{repoUrl}`
- Analyst comments: `{comments}`

## Source files to read
The change-proposal lives at `<worktree>/openspec/changes/{tag}/`. Read every file you find there so the PR title and body reflect the actual change:

- `proposal.md` — what and why
- `design.md` — design decisions (if present)
- `adr.md` — architectural decisions (if present)
- `specs/<capability>.md` — delta-specs (if the directory exists)

## Steps

1. Read every source file listed above. The `Proposal` section, the `Why` / `Motivation` paragraph, and any explicit `Tasks` or `Out of scope` notes are the most useful bits for the PR body.
2. Compose a PR **title** — under 70 characters, imperative mood ("Add X", not "Added X"). Pull it from the first line of `proposal.md` if it's already in that shape.
3. Compose a PR **body** - under 512 characters. Recommended structure:
   - **Summary** — one paragraph lifted from `proposal.md`
   - **Why** — the motivation / problem statement
4. Compose project and repository name from "{repoUrl}". Check "{repoUrl}", it ends with "<project>/<repository>.git".
5. Open the PR through the MCP tool called `mcp__sourcecontrol__git_create_pull_request`. Typical invocation:
   ```
   mcp__sourcecontrol__git_create_pull_request({
     project:    "<your project>,
     repository: "<your repository>",
     head:       "{branch}",
     base:       "{baseBranch}",
     title:      "<your title>",
     body:       "<your body>"
   })
   ```
6. Report the resulting PR URL in your final response so the analyst can copy it from the log.

## Constraints
- Don't modify the change-proposal files — they were already approved by the analyst.
- Don't push the branch yourself — `Опубликовать ветку` is a separate step the user must have already taken.
- Don't squash / rebase / rewrite history. The PR is opened against the current HEAD of `{branch}`.
- Don't fall back to the `gh` CLI on MCP failure — surface the MCP error verbatim and stop. Falling back masks configuration drift between sdd-board and the host environment.
