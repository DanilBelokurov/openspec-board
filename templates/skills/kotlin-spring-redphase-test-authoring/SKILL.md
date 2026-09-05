---
name: kotlin-spring-redphase-test-authoring
description: Generate **failing-first (red-phase)** Kotlin + Spring tests that match the project's established style — JUnit 5 + AssertJ, Gradle `testFixtures` builders with `test*` factories, `@SpringBootTest` + MockServer + MockMvc for integration, Awaitility for async waits, and backtick `Should ...` test names. Use when the production code does not exist yet (TDD red phase), when an acceptance criterion is given but the implementation is still ahead, or when other agents need to write the test that will drive the next implementation commit.
---

# Kotlin + Spring Red-Phase Test Authoring

Reusable test-authoring skill. Project-agnostic: it encodes a **style baseline** (JUnit 5, AssertJ, Awaitility, MockServer, MockMvc, `testFixtures`, backtick `Should ...` names). On every project invocation, **first detect the actual conventions** and adapt the baseline — do not project this baseline blindly if the project contradicts it.

## Mission

Write a test that fails today because the production type/function does not exist (or does not yet behave as required), and that will go green as soon as a teammate writes the minimum implementation to satisfy it.

The skill is about **the test**, not the implementation. The test is the deliverable.

## What "Red Phase" Means Here

The production code under test may not exist, may exist only partially, or may live in a different module that this skill must not touch. Concretely:

- The new public function/class can be referenced from the test even if it does not compile yet — the test failing to compile **is** the red signal.
- Imports of not-yet-created production types are allowed in the test source set.
- New `testFixtures` factories for not-yet-created production types are allowed; they are scaffolding for the test, not the implementation.
- This skill **does not** generate the production code. Hand off to the project's implementation agent (e.g. `kotlin-api-developer`, `kotlin-data-architect`, `kotlin-integration-specialist`, or whatever the project uses).

## Project Bootstrap — read this first on every new project

Before applying any rule below, **inspect the target project** and confirm the baseline. The baseline is opinionated; some projects legitimately diverge. In that case, **defer to the project**, not to this skill.

1. **Stack confirmation.** Open `*.gradle.kts` / `build.gradle` / `libs.versions.toml` / `pom.xml` and list:
   - JUnit Jupiter vs JUnit 4 vs Kotest vs TestNG
   - AssertJ vs Hamcrest vs Strikt vs Truth
   - Awaitility presence
   - MockServer / WireMock / MockWebServer / none
   - Spring Boot test starter + `spring-integration-test`
   - `jackson-module-kotlin`, `jsonassert`
2. **Test source sets.** Find every `src/<sourceSet>/kotlin/...` directory. Common Gradle conventions: `test` (unit), `integrationTest` (Spring), `e2eTest` (full system), but the project may name them anything.
3. **`testFixtures` discovery.** Search `*.gradle.kts` for `testFixturesApi` / `testFixturesImplementation` and map which module exposes which factory namespace.
4. **Naming convention.** Read 3–5 existing tests. Confirm backtick names, `Should ...` prefix, and `internal class` vs `class` usage. If the project uses camelCase JUnit names or another style, **match the project** and call it out in `Output Contract → Conventions adopted`.
5. **Forbidden libraries.** Search for `mockk`, `mockito`, `kotest` imports. If the project already uses one, treat that as the de-facto choice for that project and drop the corresponding ban.
6. **Channel / messaging utilities.** If the project uses Spring Integration channels, look for `TestChannelInterceptor` or similar helpers; if absent, use `MessageHandler` mocks or `MessageChannel.send` capture patterns instead.

Only after this pass should the rules below apply. Every rule below is **conditional on the baseline holding**.

## Stack Baseline (assumed; override if project differs)

- **Test framework:** JUnit 5 (`org.junit.jupiter.api.Test`, `@ExtendWith`).
- **Assertions:** AssertJ (`org.assertj.core.api.Assertions.assertThat` + `Consumer<T>` for `satisfies`).
- **Async waits:** Awaitility (`org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(...))`).
- **HTTP mocking:** `org.mock-server:mockserver-junit-jupiter` via `@ExtendWith(MockServerExtension::class)` + `@MockServerSettings(ports = [...])`. Fallback: WireMock, MockWebServer.
- **HTTP testing MVC:** `MockMvc` DSL (`mockMvc.get(...)`, `mockMvc.patch(...)`).
- **Integration channel capture:** project's `TestChannelInterceptor` (or equivalent).
- **JSON:** `com.fasterxml.jackson.module.kotlin.jacksonObjectMapper()` + `readValue<T>(...)`.
- **JSON assertion:** `org.skyscreamer:jsonassert` (via Spring's `content { json(...) }`).
- **Forbidden by default:** Mockito, MockK, Kotest. If the project uses one, lift the ban and note it.

## Test Layers

The project typically uses two (sometimes three) physical Gradle source sets. Detect them and fill in the table:

| Layer | Source set | When to use | Annotation stack |
|---|---|---|---|
| Unit | `src/<unit>/kotlin/...Test.kt` | Pure logic, extensions, mappers, JSON SerDe | none / plain JUnit 5 |
| Integration | `src/<integration>/kotlin/...Test.kt` | Spring wiring, channels, HTTP endpoints, MockServer-backed HTTP | `@SpringBootTest` + `@SpringIntegrationTest` + `@ContextConfiguration` |
| E2E | `src/<e2e>/kotlin/...Test.kt` (if any) | Full system, Testcontainers, real broker | full `@SpringBootTest(webEnvironment = RANDOM_PORT)` |

For red phase, the rule is: do not lift a unit test into the heavier source set just because the production class is not there yet. Pick the layer based on **what behaviour you are proving**, not on what is convenient to compile.

## File Layout And Naming

- Package mirrors the production package the test will exercise.
- File name = `<TypeUnderTest>Test.kt` (or `<Feature>Test.kt`).
- One test class per production type / per integration scenario. Do not pile multiple `internal class` siblings into one file unless the project already does so.
- If the project has an `AppTest` / `ApplicationTest` at the module root that loads the full context, subclass it for property variations (e.g. `DisabledClientAppTest : AppTest()` with `@TestPropertySource(properties = [...])`). Match whichever pattern the project uses.

## Class Shape

Unit test:

```kotlin
package <production package>

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import <testFixtures import from the SAME or upstream module>

internal class <TypeUnderTest>Test {

    @Test
    fun `Should <observable behaviour> as <condition>`() {
        // arrange / act / assert
    }
}
```

Integration test (Spring Boot + Spring Integration + MockServer):

```kotlin
package <integration package>

@ExtendWith(MockServerExtension::class)
@MockServerSettings(ports = [9090])
@ContextConfiguration
@SpringBootTest(properties = ["logging.level.org.springframework.integration=debug"])
@SpringIntegrationTest
class <Feature>Test(
    @Autowired private val <production beans>: <Types>,
    ...
) {

    @Test
    fun `Should <observable behaviour> as <condition>`(mockServer: MockServerClient) {
        // arrange / act / assert
    }

    @AutoConfigureJson
    @Configuration
    @Import(
        <ProductionConfiguration>::class,
        <TestIntegrationConfiguration>::class,
    )
    @EnableConfigurationProperties(<PropertiesClass>::class)
    class Config
}
```

Visibility rule (default): `internal class` for unit tests; `class` (public) for integration tests with `@SpringBootTest`. Override if the project convention differs.

## Test Method Names

- Always backtick Kotlin identifiers.
- Always start with `Should ` (capital S, single space).
- State the **observable behaviour**, not the implementation.
- Write the name as the **contract the production code must fulfil**, not as a description of a method that exists. The test is the spec.
- Avoid `shouldXxx` camelCase, snake_case names, or anything starting with `test`.

## Test Data: use `testFixtures`, never inline

If the project ships Gradle `testFixtures`:

1. **Always import from `testFixtures`** — never construct domain objects inline in a test.
2. Use **named arguments** to make the scenario obvious: `testClient(num = 2, enabled = true)`.
3. Use **sensible defaults** for values the test does not care about — do not pass every field.
4. To customise a value referenced in an assertion, wrap it in a factory like `testXxxId(2)` instead of asserting the magic number `2`.
5. To build an empty collection, use `arrayOf()` spread: `testRange(*emptyArray())` or equivalent `vararg` form. Do not use `mutableListOf()` for empty inputs.
6. When you need random data (so multiple objects do not collide), default to `Random.nextInt()` if the project does so.

### Adding a new `testFixture` in red phase

If the production type under test does not exist yet, **its `testFixture` factory must also be created as part of the red-phase scaffolding** — otherwise the test cannot even compile. Shape:

```kotlin
package <module package>

fun test<TypeName>(
    foo: Int = 1,
    bar: String = "default",
): <TypeName> = <TypeName>(foo, bar)
```

- Top-level function, no class wrapper.
- Lower-case `test` prefix.
- Camel-case type name after `test`.
- All parameters named, all defaulted.
- Single-expression body returning the constructed object.
- Place in the module that **owns** the type, then expose it to consumers via `testFixturesApi(...)` / `testFixtures(testFixtures(project(":...")))` in the consumer's `*.gradle.kts`.

When the production class is created, the `testFixture` should keep the same default values it had during red phase — the test must not need to change just because the constructor signature stabilised.

## Assertion Style

- Use `assertThat(actual).<matcher>` only. No `org.junit.jupiter.api.Assertions.assertEquals` if the project standardises on AssertJ.
- For collections, prefer:
  - `.hasSize(n)`
  - `.hasSize(1); .single()` (chain on the result of `single()`)
  - `.isEmpty()`
  - `.allSatisfy { ... }` for property-based checks across all elements.
- For nested objects, prefer `.satisfies(Consumer { ... })` over nested `assertThat`. Reuse the `Consumer` via a local `val` when you need the same shape twice.
- For index access in tests, free to use `result[0].groups[0].clients[0].isActive` — but always pair it with a `hasSize` so the test fails loudly when empty.
- For MockMvc, use the Kotlin DSL:
  - `mockMvc.get(path, serial).andExpect { status { isOk() }; content { json(...) } }`
  - `mockMvc.patch(path, serial) { contentType = MediaType.APPLICATION_JSON; content = ... }.andExpect { status { isNoContent() } }`
  - `mockMvc.post(path, "x").andExpect { status { isMethodNotAllowed() } }` (only to assert negative cases).
- For wire-format checks (e.g. JSON contains a specific root key or namespace literal), use `assertThat(json).contains("...")`. This is the typical level of detail — not deep equal of full JSON, not white-box traversal.

### Red-phase assertion discipline

- Assert **observable behaviour**, not implementation steps.
- One clear reason for failure per test.
- Prefer `hasSize` + `single()` over `isEqualTo(expectedList)` — when the implementation over- or under-produces, the failure message is more useful.
- When the contract is "this should not happen", write a negative test as a first-class case, not as an afterthought.

## Async And Timing

- Never `Thread.sleep`. Always `Awaitility.await().atMost(Duration.ofSeconds(N)).until { ... }`.
- Default budget: `Duration.ofSeconds(5L)`. Raise for slow broker tests, lower for in-memory assertions.
- For messaging flows, capture channels via the project's `TestChannelInterceptor` (or equivalent), then assert on `interceptor.getSentMessages(channel).single().payload`.

## HTTP Mocking (MockServer)

- Register at the class level:
  ```kotlin
  @ExtendWith(MockServerExtension::class)
  @MockServerSettings(ports = [9090])
  ```
- Inject `mockServer: MockServerClient` as a test method parameter (JUnit 5 resolver).
- Build expected requests with `HttpRequest.request().withMethod(...).withPath(...).withQueryStringParameter(...).withBody(...)`.
- Stub with `mockServer.`when`(expected).respond(HttpResponse.response().withStatusCode(...).withBody(json, MediaType.APPLICATION_JSON))`. (Note the backticks around ``when``.)
- Verify a request was sent with `await().atMost(...).until { mockServer.retrieveRecordedRequests(expected).size == 1 }`.
- For WireMock / MockWebServer, swap the imports but keep the same shape (stub at class level, verify with Awaitility).

In red phase, MockServer expectations describe the **wire contract** the new production code must satisfy. Do not encode the current implementation's private behaviour.

## Resource Loading (JSON fixtures)

- Place large JSON payloads under `src/test/resources/<full/lower/dotted/package/path>/<filename>.json`.
- Load with `ClassLoader.getSystemResourceAsStream(path).readBytes()` (note: not `.bufferedReader()`, raw bytes + `objectMapper.readValue<T>(bytes)` is the typical pattern).
- Path style mirrors the package directory structure.

## Integration Test Wiring

- Always combine `@ContextConfiguration`, `@SpringBootTest(...)`, `@SpringIntegrationTest` for Spring Integration flows. If the project uses only MVC (no Integration), drop `@SpringIntegrationTest`.
- For property variations on the same context, subclass the base `<AppTest>` and annotate the subclass with `@TestPropertySource(properties = [...])`. Do not duplicate the context-loading test.
- Inner `@Configuration` class named `Config` (or whatever the project uses) is the convention. Annotate with:
  - `@AutoConfigureJson` (if the project uses it)
  - `@Configuration`
  - `@Import(<production configuration classes>, <TestIntegrationConfiguration>::class)`
  - `@EnableConfigurationProperties(<properties class>::class)`
- Use the project's shared `<TestIntegrationConfiguration>` to wire in-memory store beans (`SimpleMessageStore`, `SimpleMetadataStore`, etc.) when Spring Integration stores are involved.
- When you need to stub a downstream flow inside the test (e.g. an `integrationFlow` that just produces a fixed response), wire the bean inside the test's `class Config { @Bean fun ... }`. Do not produce it from the shared `TestIntegrationConfiguration`.

### Red-phase integration wiring

If the production `@Configuration` class does not exist yet, the integration test will not compile. Two acceptable patterns:

1. **Defer the integration test** — write the unit test first, leave a `// TODO: integration test after <Configuration> lands` note in the acceptance file.
2. **Write the integration test against the eventual package** (`@Import(FutureConfiguration::class)`), accepting that the project will not build until the class exists. Add a clear note in the output contract so the human/orchestrator knows the failure is expected.

Prefer pattern 1 unless the integration behaviour is the actual acceptance criterion.

## MockMvc Patterns

- Activate with `@AutoConfigureMockMvc` and inject `MockMvc`.
- Use `mockMvc.get(path, serialNumber)` / `mockMvc.patch(path, serialNumber)`.
- For PATCH, attach body via the DSL block:
  ```kotlin
  mockMvc.patch(path, serial) {
      contentType = MediaType.APPLICATION_JSON
      content = objectMapper.writeValueAsString(payload)
  }
  ```
- Negative cases use `isNotFound`, `isMethodNotAllowed`, `isUnsupportedMediaType`, `isBadRequest`.
- For application-defined constants (paths), inject `@Autowired private val properties: <...>Properties` and use `properties.<path>` — never hard-code the path.

## What To Cover In One Test Pass

For every public extension / function under test:

1. The happy path with a minimal fixture.
2. A larger variant (multiple entities) when iteration logic exists.
3. The empty-collection variant (`*emptyArray()` for varargs).
4. At least one negative case for any branch that can fail.

For HTTP / integration:

1. Happy path producing a downstream message or HTTP response.
2. Negative content-type / negative JSON content.
3. Wrong HTTP method (where the controller allows multiple verbs).
4. Property-driven subclass test when behaviour switches on a flag.

In red phase, prefer **one failing scenario per `@Test`** so the future developer gets an unambiguous green signal per case.

## What Not To Do

- ❌ Inline construction of domain objects when a `test*` factory exists.
- ❌ `Mockito.mock(...)`, `@MockBean`, `mockk()` — unless the project already uses them.
- ❌ `Thread.sleep`, `kotlinx.coroutines.delay` in tests.
- ❌ Test names without backticks, or starting with `test`, or camelCase (unless the project already uses camelCase).
- ❌ `data class` test fixtures with all-required constructors.
- ❌ Multiple unrelated scenarios inside a single `@Test` method.
- ❌ Asserting on private fields or method ordering.
- ❌ Hard-coding the configured REST path string instead of injecting `*Properties`.
- ❌ Putting `@SpringBootTest` tests under the unit-test source set.
- ❌ Putting pure logic tests under the integration source set — they slow down the fast suite.
- ❌ Writing the production code "to make the test pass" inside this skill. If the test needs an extra method on a class, stop and hand off.
- ❌ Editing production `*.kt` files. Edit only test source sets and `testFixtures`.
- ❌ Skipping the assertion because the type does not exist yet — assert against the contract, not the current build status.

## Output Contract

When the skill is invoked, return these sections:

- `Conventions adopted`: result of the Project Bootstrap pass — list actual libraries, source-set names, naming pattern, and any project-specific deviations from this baseline.
- `Acceptance criterion`: the exact contract the test will assert against (quoted or paraphrased from the task).
- `Red signal`: how the failure will manifest today (compile error? missing class? missing fixture? wrong status?).
- `Test plan`: which layer (unit vs integration), which `testFixtures` will be reused vs created.
- `Generated tests`: the concrete `*.kt` file(s) with full bodies. Compile errors against non-existent production code are expected and acceptable.
- `Test fixtures`: any new `testFixtures` functions to add (with package and exact location).
- `Build wiring`: any `*.gradle.kts` updates needed (`testImplementation(testFixtures(...))`, `integrationTestApi(...)`).
- `Hand-off`: what the implementation agent must produce to turn these tests green. Do **not** include the implementation — only the contract.
- `Verification`: the exact Gradle / Maven invocation that should run and **must fail** before the fix.

## Quick Reference Card

| Need | Use |
|---|---|
| Plain `@Test` | `org.junit.jupiter.api.Test` |
| Assertion | `assertThat(...).xxx()` from AssertJ |
| Wait for async | `await().atMost(Duration.ofSeconds(5L)).until { ... }` |
| Stub HTTP | `@ExtendWith(MockServerExtension::class)` + `@MockServerSettings(ports = [...])` |
| Test HTTP MVC | `@AutoConfigureMockMvc` + `mockMvc.get / patch / post` |
| Capture channel messages | project's `TestChannelInterceptor(channel).getSentMessages(channel)` |
| Build domain data | `test*` factory from the relevant `testFixtures` |
| Read JSON resource | `ClassLoader.getSystemResourceAsStream(path)!!.readBytes()` |
| Override properties for one test class | `@TestPropertySource(properties = [...])` on a subclass of `<AppTest>` |
| Failing compile against missing prod code | expected — do not paper over it |

## Quality Bar

A good run of this skill produces tests that:

- fail today in the **right way** (compile error pointing at the missing production symbol, or assertion mismatch against current behaviour) and pass tomorrow when the contract is implemented,
- encode a contract a reviewer can read and approve without seeing the implementation,
- compile without touching `build.gradle.kts` beyond what's listed in `Build wiring`,
- run inside the existing Gradle / Maven task without new configuration,
- read like a `git blame` line — a reviewer cannot tell the test was generated,
- reuse fixtures instead of rebuilding domain objects.

A bad run produces tests that:

- use Mockito, MockK, Kotest, or `Thread.sleep` when the project does not,
- invent their own builders instead of extending `testFixtures`,
- encode the implementation steps instead of the observable contract,
- land a `@SpringBootTest` inside the unit-test source set,
- silently mutate production code "to compile",
- claim to be red-phase but assert against the current (wrong) behaviour instead of the desired one,
- blindly apply this baseline to a project that uses Kotest / Strikt / WireMock without acknowledging the deviation.
