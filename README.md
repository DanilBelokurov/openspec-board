# SDD Sessions Board

UI-доска для управления жизненным циклом change-proposal в экосистеме OpenSpec. Поддерживает **два режима работы** в одном экземпляре приложения: **«Разработчик»** (имплементация уже утверждённых change) и **«Аналитик»** (подготовка change-proposal через gigacode). Стиль вдохновлён [makeplane/plane](https://github.com/makeplane/plane) — sidebar, board, плотные карточки, neutral палитра.

## Стек

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** (Plane-like палитра — `bg-surface`, `border-border`, `text-slate-700`)
- **lucide-react** (иконки)
- UI и backend — на одном порту (`3000`)

## Архитектура

```
sdd-board/
├── app/                                # Next.js App Router
│   ├── layout.tsx                      # root layout, монтирует CreateProposalProvider + RepoBuildToaster
│   ├── page.tsx                        # Board view (главная)
│   ├── changes/[tag]/page.tsx          # детальная страница задачи
│   ├── api/
│   │   ├── health/                     # GET — liveness stub
│   │   ├── config/                     # GET / PUT — настройки (openspecDir, mode, defaultBranch, repos, scanInterval)
│   │   ├── changes/                    # GET — список tasks
│   │   ├── changes/[tag]/              # GET — детальное состояние одной задачи
│   │   ├── changes/[tag]/open/         # POST — открыть в Finder
│   │   ├── changes/[tag]/confirm/      # POST — Подтверждено (analyst pipeline)
│   │   ├── changes/[tag]/update-…/     # POST — перезапуск артефакта с комментарием (proposal/delta-spec/design/adr)
│   │   ├── changes/[tag]/delete/       # POST — удалить task + worktree + branch
│   │   ├── changes/[tag]/push/         # POST — git push (developer mode done)
│   │   ├── changes/[tag]/create-pull-request/  # POST — gigacode для PR
│   │   ├── changes/[tag]/reopen/       # POST — откатить на более ранний этап (analyst mode done)
│   │   ├── changes/[tag]/deploy-status/       # GET — статус push/PR для polling
│   │   ├── changes/[tag]/start/        # POST — начать работу (developer mode backlog)
│   │   ├── refresh/                    # POST — scan (analyst или developer в зависимости от mode)
│   │   ├── repos/                      # POST — добавить submodule репо
│   │   ├── repos/[name]/               # DELETE — удалить submodule репо
│   │   └── repos/build-status/         # GET — статус code-review-graph build/visualize
├── components/
│   ├── TopBar.tsx                      # Хедер: mode-switcher, settings, refresh, New proposal
│   ├── SettingsDialog.tsx              # Модалка настроек
│   ├── Board.tsx                       # Контейнер с колонками
│   ├── Column.tsx                      # Одна колонка
│   ├── SessionCard.tsx                 # Карточка-линк → /changes/[changeName]
│   ├── FileTree.tsx                    # Рекурсивное дерево файлов (клик → open)
│   ├── CopyPathButton.tsx              # Копировать путь
│   ├── OpenInFinderForm.tsx            # Open in Finder (fetch, не нативная форма)
│   ├── StartForm.tsx                   # Форма «Начать работу» (developer mode)
│   ├── ConfirmArtifactButton.tsx      # «Подтверждено» + карандашик (для proposal/delta-spec/design/adr)
│   ├── TaskActions.tsx                 # Копировать / Удалить (для всех стадий)
│   ├── DoneTaskActions.tsx             # Закрыть / Редактировать (только analyst mode done)
│   ├── DoneDeploymentActions.tsx       # Опубликовать ветку / Сделать pull request (только analyst mode done)
│   ├── ReopenTaskDialog.tsx            # Модалка отката на этап (analyst mode done)
│   ├── CreateProposalDialog.tsx        # Модалка создания proposal (analyst mode)
│   ├── CreateProposalContext.tsx       # React Context для открытия диалога из любого места
│   ├── GlobalCreateProposalDialog.tsx  # Instance диалога, рендерится в layout
│   ├── RepoBuildToaster.tsx            # Toast-уведомления о завершении code-review-graph
│   └── … все в "use client" где нужны event handlers
├── lib/
│   ├── config.ts                       # read/write .sdd-board/config.json
│   ├── state.ts                        # TaskEntry, AppState, readState, updateTask, mergeScanWithState, mergeDeveloperScan
│   ├── openspec.ts                     # парсеры proposal.md / design.md / specs/*.md, listChangeTree, formatBytes, ChangeSummary/BoardItem, pipelineStatus
│   ├── openspec-scanner.ts             # scanChangeProposalsOnBranch (git ls-tree + git show)
│   ├── continuation.ts                # STAGE_CONFIG, triggerContinueIfNeeded, runUpdateArtifact, commitChange, spawnCreatePullRequestGigacode
│   ├── process.ts                      # isProcessAlive(process.kill(pid, 0))
│   ├── process-logger.ts               # spawnDetachedWithLog (логи в .sdd-board/logs/)
│   ├── code-review-graph.ts            # spawnCodeReviewGraphBuild/Visualize — gigacode + MCP server code-review-graph
│   ├── git-push.ts                     # spawnGitPush (detached)
│   ├── git.ts / git-worktree.ts /      # developer-mode worktree create/remove
│   │   git-cleanup.ts                  # (тоже для reopen)
│   ├── watcher.ts                      # polling 5s: triggerContinueIfNeeded, exit code tracking, periodic developer scan
│   ├── tag.ts                          # isValidOpenspecTag
│   ├── jira.ts                         # extractJiraId
│   ├── repo-name.ts                    # deriveRepoNameFromUrl (pure)
│   ├── format.ts                       # formatDateTime (MSK timezone)
│   ├── modes.ts                        # MODES (analyst + developer), STAGE_META (label + icon)
│   ├── path-utils.ts                   # repoBasename
│   └── … различные helpers
├── templates/
│   ├── spec-driven/
│   │   ├── create-artifact-prompt-template.md   # для /opsx-continue (proposal/specs/design/adr)
│   │   └── update-artifact-prompt-template.md   # для карандашика в ConfirmArtifactButton
│   └── git/
│       └── create-pull-request-template.md      # для /create-pull-request
│   └── code-graph-review/
│       ├── build-graph.md               # gigacode: build_or_update_graph_tool + architecture_overview_tool
│       └── visualize-graph.md           # gigacode: re-emit architecture overview as JSON
├── docs/
│   └── sdd-directory.md                # описание структуры OpenSpec-каталога
├── tailwind.config.ts
├── postcss.config.js
├── next.config.mjs
├── tsconfig.json
└── package.json
```

## Два режима работы

`AppConfig.mode` — это переключатель между двумя непересекающимися наборами stages. Каждая задача принадлежит ровно одному режиму (поле `TaskEntry.mode`), режим ставится при создании и больше не меняется.

### Режим «Разработчик» (developer)

| Стадия | Назначение |
| --- | --- |
| `backlog` | Change-proposal обнаружен в `defaultBranch` (после PR merge upstream), ещё никто не взял |
| `decomposition` | Разработчик изучает change: читает proposal/design/specs, оценивает объём |
| `plan` | План готов: порядок коммитов, риски, оценка |
| `develop` | Код пишется |
| `tests` | Тесты пишутся / гоняются |
| `deploy` | Деплой / PR review |
| `done` | Задача завершена |

`TaskEntry.codeBranch` хранит имя remote ветки, `codeBaseSha` — commit SHA в этой ветке, `archived` — `true` когда upstream перевёл change в `archive/`.

### Режим «Аналитик» (analyst)

| Стадия | Назначение |
| --- | --- |
| `proposal` | Создана директория `<worktree>/openspec/changes/<tag>/` через `openspec new change` |
| `delta-spec` | Сгенерирован `specs/<capability>.md` (delta-спецификации) |
| `design` | Сгенерирован `design.md` |
| `adr` | Сгенерирован `adr.md` |
| `done` | Change-proposal готов (после `Подтверждено` на adr) — пользователь пушит ветку и открывает PR |

Pipeline работает в worktree на ветке `feature/<JiraID>`. Каждая стадия ждёт side-effect на диске (`.openspec.yaml`, `proposal.md`, `specs/*.md`, `design.md`, `adr.md`) — `triggerContinueIfNeeded` в `lib/watcher.ts` спавнит `gigacode --prompt` для следующего шага только когда предыдущий завершён. Переход `proposal → delta-spec → design → adr → done` происходит по нажатию кнопки «Подтверждено» (`POST /api/changes/<tag>/confirm`), который делает `git commit` на каждом шаге.

## Поток данных в детальной странице (один task)

`app/changes/<tag>/page.tsx` (server component):

```
1. readConfig()       → config.openspecDir, config.defaultBranch, config.mode
2. readState()        → task = state.tasks[tag]
3. resolveProposalRootForTask(task, config.openspecDir)
   ↳ returns task.openspecWorktreePath if set, else config.openspecDir
4. isStageReady(…)    → is the artefact on disk for the current stage?
5. PipelineRunning    → is any of openspecNewPid/gigacodeContinuePid/…
                          /<stage>CreatePid/<stage>UpdatePid still alive?
6. showConfirmButton  = currentStageReady && !currentStageError && !PipelineRunning
7. render DoneDeploymentActions (only mode==='analyst' && stage==='done')
8. render TaskActions/DoneTaskActions (depending on mode+stage)
9. render collapsible process cards for each active sub-step
```

Все process-карточки (`<details>`) с `ProcessStatusIcon` — кликабельный summary который разворачивает `Запущено:`, `PID`, `Лог:`. По умолчанию свёрнуты.

## Конечные точки (API)

### Настройки

| Метод | Путь | Тело / Ответ |
| --- | --- | --- |
| GET | `/api/config` | `AppConfig` целиком |
| PUT | `/api/config` | `{ openspecDir?, mode?, defaultBranch?, repos?, developerScanIntervalMinutes? }` |

`developerScanIntervalMinutes` принимает 0..1440 (минуты). 0 = отключить авто-сканирование, по умолчанию выкл.

### Tasks

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/api/changes` | Список tasks из state.json |
| GET | `/api/changes/[tag]` | Один task (с полным `summary`, per-stage PIDs) |
| POST | `/api/changes/[tag]/confirm` | «Подтверждено» — `commitChange` + `stage → NEXT_STAGE[stage]` |
| POST | `/api/changes/[tag]/update-{proposal,delta-spec,design,adr}` | Карандашик: gigacode с `{artifact, json, comments}` для переписывания |
| POST | `/api/changes/[tag]/delete` | Удалить task + worktree + branch (dev/analyst) |
| POST | `/api/changes/[tag]/start` | developer-mode: создать 2 worktree, спавнить `gigacode /opsx:plan` |
| POST | `/api/changes/[tag]/reopen` | analyst-mode done: откатить stage + удалить поздние артефакты + gigacode update |
| POST | `/api/changes/[tag]/push` | developer-mode done: `git push -u origin <branch>` (detached) |
| POST | `/api/changes/[tag]/create-pull-request` | developer-mode done: gigacode с шаблоном `templates/git/create-pull-request-template.md` |
| GET | `/api/changes/[tag]/deploy-status` | Статус push + PR (для polling в `DoneDeploymentActions`) |
| POST | `/api/changes/[tag]/open` | Открыть файл/папку в системном менеджере (`child_process.exec('open', [...])`) |

### Scan

| Метод | Путь | Поведение |
| --- | --- | --- |
| POST | `/api/refresh` | `mode === "analyst"` → `mergeScanWithState(scanChangeRoots(...))` (локальные файлы). `mode === "developer"` → `mergeDeveloperScan(openspecDir, config.defaultBranch)` (git scan). Возвращает `{ scanned, total, tasks }` |

### Repos (submodules в cwd)

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/api/repos` | `git submodule add <url> repos/<name>` + checkout. `name` авто-извлекается из URL. |
| DELETE | `/api/repos/<name>` | `git submodule deinit` + `submodule rm` + удаление из конфига |
| GET | `/api/repos/build-status` | Статус `uvx code-review-graph build/visualize` для каждого репо |

`repos/` живут в `process.cwd()` sdd-board проекта (не в sdd-store). `graphs/` — сиблинг. `uvx code-review-graph build --repo <cwd>/repos/<name> --data-dir <cwd>/graphs/<name>`.

## State schema

`TaskEntry` в `lib/state.ts`:

```ts
{
  // identification
  id: string;            // randomUUID() при создании
  mode: "developer" | "analyst";   // ставится при создании, не меняется
  stage: Stage;
  lastScannedAt: string;  // ISO timestamp

  // summary (read-side cache, recreated on each scan)
  summary: ChangeSummary;  // title, hasProposal/Design/Specs, specCounts, fileCount, totalSize, ...

  // inputs (analyst flow)
  jiraUrl?: string;
  description?: string;

  // developer flow
  codeBranch?: string;    // например "master"
  codeBaseSha?: string;   // SHA merge-коммита upstream
  archived?: boolean;     // true когда upstream перевёл в archive/

  // developer worktree (после Start)
  openspecWorktreePath?: string;
  codeWorktreePath?: string;
  codeRepoPath?: string;   // input от пользователя в StartForm
  startedAt?: string;
  gigacodePid?: number | null;
  gigacodeExitCode?: number | null;
  gigacodeExitSignal?: string | null;
  gigacodeLogPath?: string;

  // analyst step 1
  openspecNewPid?: number | null;
  openspecNewStartedAt?: string;
  openspecNewExitCode?: number | null;
  openspecNewExitSignal?: string | null;
  openspecNewLogPath?: string;

  // analyst step 2 (per stage)
  gigacodeContinuePid?: number | null;
  gigacodeContinueStartedAt?: string;
  gigacodeContinueExitCode?: number | null;
  gigacodeContinueExitSignal?: string | null;
  gigacodeContinueLogPath?: string;

  deltaSpecCreatePid?: number | null;
  deltaSpecCreateStartedAt?: string;
  deltaSpecCreateExitCode?: number | null;
  deltaSpecCreateExitSignal?: string | null;
  deltaSpecCreateLogPath?: string;

  designCreatePid?: number | null;
  designCreateStartedAt?: string;
  designCreateExitCode?: number | null;
  designCreateExitSignal?: string | null;
  designCreateLogPath?: string;

  adrCreatePid?: number | null;
  adrCreateStartedAt?: string;
  adrCreateExitCode?: number | null;
  adrCreateExitSignal?: string | null;
  adrCreateLogPath?: string;

  // per-stage update (pencil button on ConfirmArtifactButton)
  proposalUpdatePid?: number | null;
  proposalUpdateStartedAt?: string;
  proposalUpdateExitCode?: number | null;
  proposalUpdateExitSignal?: string | null;
  proposalUpdateLogPath?: string;
  proposalUpdateComments?: string;
  // ...аналогично для deltaSpec/design/adr update

  // per-stage commit
  committedAt?: string;        // proposal stage
  commitExitCode?: number | null;
  commitError?: string;
  // ... deltaSpecCommit* / designCommit* / adrCommit*

  // done-stage deploy (analyst flow)
  pushedAt?: string;
  pushPid?: number | null;
  pushStartedAt?: string;
  pushExitCode?: number | null;
  pushExitSignal?: string | null;
  pushLogPath?: string;
  pushError?: string;
  pushRemoteUrl?: string;
  pullRequestPid?: number | null;
  pullRequestStartedAt?: string;
  pullRequestExitCode?: number | null;
  pullRequestExitSignal?: string | null;
  pullRequestLogPath?: string;
  pullRequestError?: string;
  pullRequestUrl?: string;
}
```

`AppConfig` в `lib/config.ts`:

```ts
{
  openspecDir: string;
  mode: "developer" | "analyst";
  defaultBranch: string;     // "master" по умолчанию
  repos?: Record<string, RepoConfig>;
  developerScanIntervalMinutes?: number;  // 0..1440, 0 = off
}
```

`RepoConfig`: `{ url, branch, trackedBase? }`.

## Settings

Кнопка ⚙ в TopBar открывает `SettingsDialog`:

| Поле | Когда видно | Описание |
| --- | --- | --- |
| **Режим доски** | всегда | «Разработчик» / «Аналитик» — переключатель |
| **Директория OpenSpec store** | всегда | Абсолютный путь к openspec-store (`<repo>/openspec/`) |
| **Browse…** | всегда | `<input type=file webkitdirectory>` — нативный фолдер-пикер, отдаёт имя выбранной папки, абсолютный путь вставить вручную |
| **Главная ветка OpenSpec store** | всегда | Имя ветки (default: `master`). Используется в: (a) `git worktree add -b feature/<JiraID> <sourceBranch>` (создание worktree в analyst-flow), (b) `git fetch origin <sourceBranch>` перед созданием worktree |
| **Интервал автосканирования (мин)** | только в `mode === "developer"` | Периодический developer-scan каждые N минут. 0 = выключить |
| **Репозитории (git submodules)** | всегда | Список добавленных репо с URL+branch. Кнопка «+» добавляет новое (name авто-извлекается из URL). Trashed icon удаляет |

## Запуск

```bash
npm install
npm run dev          # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

## Background polling

`lib/watcher.ts` стартует при первом server-side импорте (через `import "@/lib/watcher"`). Тикает каждые 5 секунд. Делает:

1. **Stage 0 (developer mode)**: если `developerScanIntervalMinutes > 0` и прошло достаточно времени с последнего скана → `mergeDeveloperScan(openspecDir, config.defaultBranch)`. Добавляет/обновляет задачи, проставляет `archived` badge.
2. **Stage 1 (analyst)**: `triggerContinueIfNeeded(openspecDir)` — для каждой task в `proposal` с `.openspec.yaml` без `proposal.md` спавнит `gigacode --prompt`. Аналогично для `delta-spec`/`design`/`adr` (когда `specs/`, `design.md`, `adr.md` отсутствуют).
3. **Stage 2 (repos)**: для каждого `repos[name]` если `buildPid` жив и `buildExitCode == null` → флипает в 0. То же для `visualizePid` (только если build уже завершился).
4. **Stage 3 (deploy)**: для каждой task в `done` (`analyst`) → `pushExitCode = 0` и `pullRequestExitCode = 0` если соответствующие PID мёртвые.

То есть watcher не «думает» — он только фиксирует exit codes и запускает следующий шаг pipeline. Логика «что делать» живёт в `triggerContinueIfNeeded` + `mergeDeveloperScan` + state-машине.

## Code-review-graph pipeline (repos)

Для каждого репо в `repos[name]`:
1. `POST /api/repos` спавнит `git submodule add <url> repos/<name>` + checkout, затем spawn'ит `gigacode` с промптом из `templates/code-graph-review/build-graph.md`. Gigacode LLM-агент вызывает `mcp__code-review-graph__build_or_update_graph_tool` (индексирует репо) + `mcp__code-review-graph__get_architecture_overview_tool` (sanity read). stdout/stderr → `.sdd-board/logs/repos/<name>.graph-build.log`.
2. Watcher (или POST /api/refresh) детектит `buildPid` живой + `buildExitCode == null` → когда умер, флипает в 0.
3. Затем спавнит `gigacode` с промптом из `templates/code-graph-review/visualize-graph.md`. Агент вызывает тот же `get_architecture_overview_tool` и оборачивает результат в JSON `{repo, repoRoot, dataDir, generatedAt, overview}` на stdout.
4. `RepoBuildToaster` (client component в layout) polling'ит `/api/repos/build-status` каждые 5с, показывает toast «Граф построен» или ошибку.

**Зачем через gigacode + MCP, а не `uvx code-review-graph build/visualize`?** MCP-сервер уже запущен в этом окружении; `gigacode` — это LLM-агент, который маршрутизирует вызовы к нему. Драйв графа через тот же LLM-driven pipeline, что генерирует proposal.md / design.md и т.д., оставляет билд расширяемым (LLM может восстановиться после частичной ошибки, повторить sub-step) и логирует prompt для post-mortem.

## Логи

Все detached subprocess'ы пишут stdout/stderr в `.sdd-board/logs/`:

```
.sdd-board/logs/
├── <tag>.continue.proposal.log        # openspec new change
├── <tag>.continue.delta-spec.log       # gigacode → specs/
├── <tag>.continue.design.log          # gigacode → design.md
├── <tag>.continue.adr.log             # gigacode → adr.md
├── <tag>.update.proposal.log           # карандашик → proposal
├── <tag>.update.delta-spec.log
├── <tag>.update.design.log
├── <tag>.update.adr.log
├── <tag>.push.log                      # git push
├── <tag>.update.adr.log (PR gigacode)  # PR gigacode (через processLogPath)
└── repos/<repo>.graph-build.log
└── repos/<repo>.graph-visualize.log
```

## Бейджи на карточке задачи

`components/SessionCard.tsx` рендерит бейджи в один ряд:

| Условие | Бейдж | Цвет |
| --- | --- | --- |
| `pipelineStatus === "running"` (analyst: `openspec new change`/`gigacode` шаги, или developer: `gigacode /opsx:plan`, или `push`/`PR` детектированный живым) | `выполняется` (Loader2 спиннер) | синий |
| `pipelineStatus === "error"` (любой exit code ≠ 0) | `ошибка` (CircleAlert) | красный |
| `pipelineStatus === "waiting"` (артефакт на диске + нет живого процесса) | `ожидает` (Hourglass) | фиолетовый |
| `archived` (`codeBaseSha` upstream уже в `archive/`) | `архив` (новое) | красный |
| `jiraUrl` задан | `JIRA-id` (ExternalLink) — кликабельный, в новой вкладке | синий |

## Кнопки действий на детальной странице

| Task.stage | mode | Кнопки |
| --- | --- | --- |
| proposal/delta-spec/design/adr | analyst | «Подтверждено» (зелёная), «Карандашик» (амбер) в карточке артефакта |
| done | analyst | «Опубликовать ветку» (sky) + «Сделать pull request» (indigo) — наверху в рамке; «Закрыть» (зелёная) + «Редактировать» (амбер) — в нижней панели |
| backlog | developer | «Начать работу» (форма) |
| decomposition/plan/develop/tests/deploy | developer | «Открыть в Finder» + «Скопировать путь» (слева) + «Копировать» + «Удалить» (справа) |
| done | developer | «Копировать» + «Удалить» (красная) |

Если `task.archived` и `task.stage !== "backlog"` → наверху детальной страницы красный баннер «⚠ Change-proposal архивирован upstream — закройте задачу вручную, когда будете готовы».

Если `task.codeBaseSha` и `task.mode === "developer"` → наверху страницы chip «Commit в `<branch>`: `<short-sha>`» с tooltip = полный SHA.

## Что ещё предстоит

- **drag&drop** между колонками (сейчас перемещение — через клик → «Начать работу» в backlog; дальше продвижение не реализовано)
- **PR-merge → task done** (двусторонняя связь с GitHub PR)
- **Показ самого proposal.md/design.md/specs/*.md** на детальной странице (сейчас только структура папки в FileTree)
- **Migration** legacy tasks без `mode` (уже есть `inferModeFromStage` при чтении state)
- **Webhook** от GitHub вместо polling
