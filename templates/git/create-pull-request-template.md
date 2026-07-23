# Create a Pull Request for the recently pushed branch

## Context
- Branch: {branch}
- Tag (change name): {tag}
- Repository: {repoUrl}
- Analyst comments: {comments}

## Source files to read
The change-proposal lives at `<worktree>/openspec/changes/{tag}/`. Read every file you find there so the PR title and body reflect the actual change:

- `proposal.md` — what and why
- `design.md` — design decisions (if present)
- `adr.md` — architectural decisions (if present)
- `specs/<capability>.md` — delta-specs (if the directory exists)

## Steps

1. Read every source file listed above. The `Proposal` section, the `Why` / `Motivation` paragraph, and any explicit `Tasks` or `Out of scope` notes are the most useful bits for the PR body.
2. Compose a PR **title** — under 70 characters, imperative mood ("Add X", not "Added X"). Pull it from the first line of `proposal.md` if it's already in that shape.
3. Compose a PR **body**. Recommended structure:
   - **Summary** — one paragraph lifted from `proposal.md`
   - **Why** — the motivation / problem statement
   - **Design notes** — anything relevant from `design.md` / `adr.md`
   - **Specs** — a bullet per file under `specs/`
4. Open the PR with the GitHub CLI. Use the base branch the project uses (most commonly `main` or `master` — pick the one that exists on the remote):
   ```
   gh pr create \
     --base <main-or-master> \
     --head {branch} \
     --title "<your title>" \
     --body  "<your body>"
   ```
   `gh` must already be authenticated (`gh auth status`). If it isn't, report the auth error in your final response and stop — don't try to fall back to `curl` against the API.
5. Report the resulting PR URL in your final response so the analyst can copy it from the log.

## Constraints
- Don't modify the change-proposal files — they were already approved by the analyst.
- Don't push the branch yourself — `Опубликовать ветку` is a separate step the user must have already taken.
- Don't squash / rebase / rewrite history. `gh pr create` just opens the PR against the current HEAD of `{branch}`.
