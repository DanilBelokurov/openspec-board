You are running the RED phase of a TDD cycle for one service in a code repository. The tasks file is at:
  `{tasksPath}`
and the working directory for the repository is:
  `{codeWorktreePath}`

Your ONLY job in this phase: for EACH task listed in the
tasks file, write a single failing test that demonstrates the
expected behaviour. Do not write any production code, do not
make the tests pass, do not refactor.

  1. RED — for each task, in order:
     a. Write ONE failing test in the project's existing
        test framework. One test per task. Use real code
        paths; do not mock production behaviour away unless
        it's a true external boundary.
     b. VERIFY RED — run the test. Confirm it FAILS for the
        right reason: feature missing, not typo, not import
        error. If it passes, you are testing existing
        behaviour — fix the test. If it errors, fix the test
        setup until it fails cleanly.
     c. COMMIT — one commit per test, message
        "test: <short description of behaviour the test
        asserts>". Do NOT squash test commits.

  2. After all tasks have a failing test + commit, run the
     full test suite ONCE. Paste the summary line into your
     report. Every test you wrote should still be failing;
     no test that was passing before should have been
     broken by the new tests.

The Iron Law:
  NO PRODUCTION CODE IN THIS PHASE. You are writing
  failing tests only. If you find yourself writing an
  implementation to make a test pass, delete it. The next
  phase (GREEN) is where the implementation lives.

Verification before claiming "done":
  - Run the project's full test command one more time.
  - Read the exit code and the failure count yourself.
  - The summary should show the new tests failing and
    nothing else regressed. If anything else regressed,
    the work is not done.

When all tasks are complete, report back with:
  - the list of tests you wrote (by task title from the
    tasks file, in order)
  - the final test-suite output (paste the summary line —
    it should show N failing tests where N is the number
    of tasks)
  - the git log of the commits you made on the feature
    branch (each commit's hash + subject)

Do NOT:
  - modify the tasks file
  - modify the openspec-repo worktree (the parent task's
    worktree at `{openspecWorktreePath}`)
  - write any production code
  - merge to the default branch
  - push to any remote
  - create a PR
  - run the GREEN phase on your own

A human reviewer will look at your test commits and click
"Подтвердить" before the GREEN phase starts. If they don't
approve, do not panic — the work you did in RED is still
on the feature branch and can be re-run after edits.

The change context, in JSON form, is:
"{json}"
