You are running the RED UPDATE phase of a TDD cycle for one service in a code repository.

A previous RED run wrote failing tests in the working tree of the code worktree:
  `{codeWorktreePath}`

The tasks file is at:
  `{tasksPath}`

# What "Red Update" Means Here

The RED UPDATE phase is a replay of RED with reviewer comments applied. The previous failing tests are still in the working tree (uncommitted, owned by the reviewer). Your job is to **rewrite those tests** so each one still fails, but now in line with the comments — and still as a pure spec, with no production code.

The production code may not exist yet, may exist only partially, or may live in a different module this prompt must not touch:

- The new public function/class can be referenced from the test even if it does not compile yet — the test failing to compile **is** the red signal.
- Imports of not-yet-created production types are allowed.
- New `testFixtures` factories for not-yet-created production types are allowed; they are scaffolding, not implementation.
- This phase does **not** generate the production code. Hand off to the GREEN phase.
- Do NOT commit. The reviewer will commit after re-reviewing.

# What You Write (and What You Do Not)

The unit of work is **one rewritten failing test per task**, in the same file locations the previous RED run used (move or split only when a comment demands it). For each task listed in the tasks file, in order:

  1. Apply the reviewer's comments to the existing failing test:
     a. Read the previous test and the comment block (below). Decide what changes the comment requires.
     b. REWRITE the test in place. Keep it failing — but for the right reason. If the rewrite makes the test pass against today's code, you encoded the current behaviour, not the desired one.
     c. VERIFY RED — run the test. Confirm it FAILS for the right reason: feature missing, not typo, not import error.
     d. If the comment requires new coverage, add a sibling failing test in the same file (or split into a new file if the scenario diverges enough to warrant it).

  2. After all tasks have a rewritten failing test, run the full test suite ONCE. Paste the summary line into your report. Every rewritten test should still be failing; no previously-passing test should have been broken by the rewrites.

The Iron Law: NO PRODUCTION CODE IN THIS PHASE. You are rewriting failing tests only. Editing a production `*.kt` file — even to "make the test compile" — is a violation; create the matching `test<Type>` factory in `testFixtures` instead.

Reviewer comments for this replay:
{comments}

# Verification Before Claiming "Done"

  - Run the project's full test command one more time.
  - Read the exit code and the failure count yourself.
  - The summary should show the rewritten tests failing and nothing else regressed.
  - A passing rewritten test is "not done": it means the test encodes the current behaviour instead of the desired one.

# Required Report

When all rewrites are complete, report back with:
  - the list of tests you rewrote (by task title from the tasks file, in order)
  - the final test-suite output (paste the summary line — it should show N failing tests where N is the number of tasks)
  - the file paths of the test files you touched
  - for each rewrite, a one-line note linking the test to the comment that drove it
  - **Skill Output Contract** — the sections the skill requires at the end of every invocation, in this order:
    - `Conventions adopted` — the Project Bootstrap result (real JUnit/AssertJ/Awaitility/MockServer stack, real Gradle source-set names, real `testFixtures` namespace, real naming pattern, and any deviations from the skill baseline)
    - `Red signal` — how each rewritten test fails today (compile error vs assertion mismatch)
    - `Test plan` — which layer (unit / integration) each test landed in, which `testFixtures` were reused, which new `testFixture` factories were added (with file path and full signature)
    - `Generated tests` — the full `*.kt` file(s) you wrote, with file path
    - `Build wiring` — any `*.gradle.kts` updates (`testImplementation(testFixtures(...))`, etc.)
    - `Hand-off` — what the GREEN agent must produce to turn each test green (no implementation code, only the contract)
    - `Verification` — the exact Gradle/Maven command you ran and its exit code (must be non-zero)

Do NOT:
  - modify the tasks file
  - modify the openspec-repo worktree (the parent task's worktree at `{openspecWorktreePath}`)
  - write any production code
  - commit anything (the reviewer commits)
  - merge to the default branch
  - push to any remote
  - create a PR
  - run the GREEN phase on your own

# Authoring Tests — MANDATORY SKILL

To write the actual test files, you MUST invoke this skill and follow its full body as authoritative:

  skill: kotlin-spring-redphase-test-authoring

The skill body lives at:

  {openspecWorktreePath}/templates/skills/kotlin-spring-redphase-test-authoring/SKILL.md

If your environment cannot invoke skills by name, read that file yourself and treat its full content as authoritative. It encodes the project's red-phase test style baseline (JUnit 5 + AssertJ, Awaitility, MockServer/MockMvc, `testFixtures` builders with `test*` factories, backtick `Should ...` names) plus the **Project Bootstrap** pass that detects the actual conventions before applying the baseline.

Apply the same rules as the initial RED run:

  - Project Bootstrap first — list the actual stack, source sets, `testFixtures` namespace, naming convention; defer to the project where it diverges.
  - Reuse `testFixtures` factories; never inline-construct domain types.
  - Backtick test names, `Should <observable behaviour>` prefix.
  - `assertThat(...)` from AssertJ only.
  - `await().atMost(...)` only — no `Thread.sleep`.
  - One `@Test` per acceptance criterion.
  - This skill is about the **test**, not the implementation — Iron Law forbids production code.

The change context, in JSON form, is:
"{json}"
