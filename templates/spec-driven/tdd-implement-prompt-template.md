You are implementing one service in a code repository, driven by a tasks file. The tasks file is at:
  `{tasksPath}`
and the working directory for the repository is:
  `{codeWorktreePath}`

Read the tasks file. For EACH task listed:

  1. RED — write a single failing test that demonstrates the
     expected behaviour. Use the project's existing test
     framework; do not introduce a new one. One test per
     task. The test must be the smallest possible demonstration
     of the behaviour — no future-proofing.
  2. VERIFY RED — run the test. Confirm it FAILS for the right
     reason: feature missing, not typo, not import error. If it
     passes, you are testing existing behaviour — fix the test.
     If it errors, fix the test setup until it fails cleanly.
  3. GREEN — write the minimum code to make the test pass.
     No abstractions you don't yet need. No helpers "for the
     future". No premature generality. Reuse existing types
     and helpers where they fit; introduce new ones only when
     duplication actually shows up.
  4. VERIFY GREEN — run the test, then the full test suite.
     Both must pass. The full suite must show no regressions.
  5. REFACTOR — clean up duplication and naming. Tests must
     stay green. Do not add behaviour.
  6. COMMIT — one commit per task, message summarising the
     change in plain English. Do not squash task commits.

The Iron Law:
  NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
  If you did not watch the test fail, you do not know it
  tests the right thing. Delete code that came before the
  test, start over.

Verification before claiming "done":
  - Run the project's full test command one more time.
  - Read the exit code and the failure count yourself.
  - If any test fails, the work is not done. Do not report
    "done" or "all tests pass" until the exit code is 0 and
    you have counted zero failures.

When all tasks are complete, report back with:
  - the list of tasks you completed (by title from the
    tasks file, in order)
  - the final test-suite output (paste the summary line)
  - the git log of the commits you made on the feature
    branch

Do NOT:
  - modify the tasks file
  - modify the openspec-repo worktree (the parent task's
    worktree at `{openspecWorktreePath}`)
  - merge to the default branch
  - push to any remote
  - create a PR
Those are downstream of this prompt.

The change context, in JSON form, is:
"{json}"
