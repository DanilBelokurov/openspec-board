You are running the GREEN phase of a TDD cycle for one service in a code repository. The RED phase has already been completed and approved by a human reviewer — the failing tests are committed on the feature branch in your working directory:
  `{codeWorktreePath}`

The tasks file the reviewer approved is at:
  `{tasksPath}`

Read the existing failing tests on the feature branch (use
`git log feature/<branch>..HEAD` or `git show <test-commit>`
to see what RED wrote). The GREEN phase is straightforward:
make those tests pass. Do not add new tests, do not change
existing tests beyond what's needed to make them compile, and
do not refactor production code beyond what's needed for the
test to be green.

  1. GREEN — for each task, in order:
     a. Run the test that RED wrote for this task. Confirm
        it FAILS (it should — RED's job was to make it
        fail).
     b. Write the MINIMUM production code needed to make
        that one test pass. No abstractions you don't yet
        need. No helpers "for the future". Reuse existing
        types/helpers where they fit. One test at a time
        — don't implement two tasks' features at once.
     c. VERIFY GREEN — run the test, then the full test
        suite. Both must pass; the previously-failing test
        now passes, no other test regressed.
     d. REFACTOR — clean up duplication and naming. Tests
        must stay green. Do not add behaviour.
     e. COMMIT — one commit per task, message
        "feat: <short description>". Do NOT squash task
        commits. Do NOT amend RED's test commits.

  2. After all tasks have a passing test + implementation,
     run the full test suite ONCE. Paste the summary line
     into your report. Every test should pass; the failure
     count should be zero.

The Iron Law (carried over from RED):
  NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. The
  tests already exist — RED wrote them and a human
  approved them. Do not add untested code paths; do not
  delete tests; do not weaken assertions.

Verification before claiming "done":
  - Run the project's full test command one more time.
  - Read the exit code and the failure count yourself.
  - If any test fails, the work is not done. Do not report
    "done" or "all tests pass" until the exit code is 0 and
    you have counted zero failures.

When all tasks are complete, report back with:
  - the list of tasks you implemented (by title from the
    tasks file, in order)
  - the final test-suite output (paste the summary line —
    it should show N passing tests where N is the number
    of tasks, 0 failing)
  - the git log of the implementation commits you made
    on the feature branch (each commit's hash + subject;
    the test commits are already in the log but don't
    count as your work)

Do NOT:
  - modify the tasks file
  - modify the openspec-repo worktree (the parent task's
    worktree at `{openspecWorktreePath}`)
  - add new tests (RED already wrote them)
  - modify RED's test commits
  - merge to the default branch
  - push to any remote
  - create a PR

The change context, in JSON form, is:
"{json}"
