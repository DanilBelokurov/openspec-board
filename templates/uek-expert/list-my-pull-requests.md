# List my pull requests via bitbucket-mcp

## Goal

Fetch the pull requests assigned to me (or where I participate) across all
repositories. The data is consumed by the UEK-expert review board on the sdd
board — see `lib/uek-expert/scanner.ts` for the consumer side and the
expected shape.

## Steps

1. Call `mcp__bitbucket__list_my_pull_requests` with these arguments:
   ```
   {
     "role": "REVIEWER",
     "state": "OPEN",
     "order": "NEWEST",
     "limit": 50
   }
   ```
   - `role: REVIEWER` filters to PRs where I am a reviewer — these are the ones
     that drive the UEK review board.
   - `state: OPEN` keeps the result scoped to active work; MERGED/DECLINED PRs
     are handled separately by the board's column logic.
   - `limit: 50` is a sane upper bound for a single scan; pagination is
     not needed in the first iteration.
2. Parse the JSON array returned by the tool. Each element is a pull request
   with at least these fields:
   - `id` — number, the PR id (convert to string).
   - `title` — string.
   - `url` or `links.self[0].href` — string, the Bitbucket PR URL.
   - `toRepository.name` (or equivalent) — repository name; we want
     `"<project>/<repo>"`. If only the slug is returned, derive the
     display name from `repository.slug`.
   - `author.user.displayName` or `author.user.emailAddress` — author label.
   - `reviewerStatus` — one of `APPROVED`, `UNAPPROVED`, `NEEDS_WORK` (default
     to `UNAPPROVED` if missing).
   - `state` — one of `OPEN`, `DECLINED`, `MERGED` (default to `OPEN`).
3. Emit the result on a single final line, exactly as a JSON object:
   ```json
   { "pullRequests": [ { "id": "123", "title": "...", ... }, ... ] }
   ```
   Do not add any explanatory text before or after that line. Trailing
   whitespace is fine; the consumer is strict about the JSON line.

## Constraints

- Use only `mcp__bitbucket__list_my_pull_requests`. Do not call
  `mcp__bitbucket__get_pull_request`, `mcp__bitbucket__get_repository`, or
  any other bitbucket tool.
- Do not call `mcp__sourcecontrol__git_*` — that's the sourcecontrol MCP,
  not bitbucket, and it doesn't have this query.
- If the tool call fails, surface the MCP error verbatim on stderr and
  exit non-zero so the watcher can record the failure.
- Do not summarise, sort, or filter the result beyond what the tool
  already returns.
