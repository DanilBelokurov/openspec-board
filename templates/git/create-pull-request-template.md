# Create a Pull Request for the recently pushed branch

## Context
- Branch (head): `{branch}`
- Base branch: `{baseBranch}`
- Tag (change name): `{tag}`
- Repository: `{repoUrl}`
- Analyst comments: `{comments}`

The base branch comes from `config.defaultBranch` (substituted into `{baseBranch}` by `spawnCreatePullRequestGigacode`). It is the trunk of the openspec store repo — typically `master` or `main`.

## Source files to read
The change-proposal lives at `<worktree>/openspec/changes/{tag}/`. Read every file you find there so the PR title and body reflect the actual change:

- `proposal.md` — what and why
- `design.md` — design decisions (if present)
- `adr.md` — architectural decisions (if present)
- `specs/<capability>.md` — delta-specs (if the directory exists)

## Steps

1. Read every source file listed above. The `Proposal` section, the `Why` / `Motivation` paragraph, and any explicit `Tasks` or `Out of scope` notes are the most useful bits for the PR body.
2. Derive `owner` and `repo` from `{repoUrl}`. For GitHub (`https://github.com/<owner>/<repo>[.git]`) and GitLab (`https://gitlab.com/<owner>/<repo>[.git]`) the segments between the host and the `.git` suffix give the two pieces. Drop the `.git` if present.
3. Compose a PR **title** — under 70 characters, imperative mood ("Add X", not "Added X"). Pull it from the first line of `proposal.md` if it's already in that shape.
4. Compose a PR **body**. Recommended structure:
   - **Summary** — one paragraph lifted from `proposal.md`
   - **Why** — the motivation / problem statement
   - **Design notes** — anything relevant from `design.md` / `adr.md`
   - **Specs** — a bullet per file under `specs/`
5. Open the PR through the MCP git server. The exact tool name depends on which MCP the user has wired up — look at the tool list available in this session and pick the one whose name ends in `create_pull_request` (or `open_pull_request`). Typical invocation:
   ```
   mcp__git__create_pull_request({
     owner:    "<owner>",
     repo:     "<repo>",
     head:     "{branch}",
     base:     "{baseBranch}",
     title:    "<your title>",
     body:     "<your body>"
   })
   ```
   Pass through any extra fields the MCP tool's schema advertises (e.g. `draft`, `maintainer_can_modify`) only if you actually want that behaviour — don't invent flags.
6. Report the resulting PR URL in your final response so the analyst can copy it from the log. The sdd-board exit handler greps the log for `/pull/<digits>` and stores the match on `task.pullRequestUrl` automatically — no extra wiring needed.

## Constraints
- Don't modify the change-proposal files — they were already approved by the analyst.
- Don't push the branch yourself — `Опубликовать ветку` is a separate step the user must have already taken.
- Don't squash / rebase / rewrite history. The PR is opened against the current HEAD of `{branch}`.
- Don't fall back to the `gh` CLI on MCP failure — surface the MCP error verbatim and stop. Falling back masks configuration drift between sdd-board and the host environment.
