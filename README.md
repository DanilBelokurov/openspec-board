# SDD Sessions Board

UI-доска для управления жизненным циклом change-proposal в экосистеме OpenSpec. Поддерживает **два режима работы** в одном экземпляре приложения: **«Разработчик»** (имплементация уже утверждённых change) и **«Аналитик»** (подготовка change-proposal через gigacode). 

## Стек

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** (Plane-like палитра — `bg-surface`, `border-border`, `text-slate-700`)
- **lucide-react** (иконки)
- UI и backend — на одном порту (`3000`)

## Инструкция по установке

### Требования

| Компонент | Версия | Зачем |
| --- | --- | --- |
| **Node.js** | ≥ 18.17 (рекомендуется 20 LTS) | Сборка и запуск Next.js 14 |
| **npm** | ≥ 9 (или pnpm/yarn) | Менеджер зависимостей |
| **Git** | ≥ 2.30 | `worktree`, `submodule`, `push`, ветки `feature/<JiraID>` |
| **gigacode CLI** | актуальный | LLM-агент для proposal/specs/design/adr/PR (должен быть в `PATH`) |
| **MCP-серверы** | `code-review-graph`, `sourcecontrol`, `jira-mcp` | Доступны из окружения gigacode; см. раздел «[MCP-серверы](#mcp-серверы)» |
| **OpenSpec-store** | локальный git-репо | Целевой репозиторий с `openspec/` директорией |

### 1. Клонирование и установка зависимостей

```bash
git clone <repo-url> openspec-board
cd openspec-board
npm install
```

### 2. Проверка окружения

```bash
node -v         # >= 18.17
git --version   # >= 2.30
which gigacode  # должен вернуть путь к CLI
```

### 4. Запуск в dev-режиме

```bash
npm run dev
# → http://localhost:3000
```

При первом открытии:

1. Нажать ⚙ в TopBar → заполнить **Директория OpenSpec store**, **Главная ветка**, выбрать **Режим доски**.
2. (Опционально) добавить репо через кнопку `+` в секции «Репозитории (git submodules)».
3. Нажать **Refresh** — задачи появятся на доске.

### 5. Production-сборка

```bash
npm run build
npm start
```

Сервер слушает порт `3000`. Логи detached-процессов пишутся в `.sdd-board/logs/`.

### Типичные проблемы

| Симптом | Причина | Решение |
| --- | --- | --- |
| `gigacode: command not found` в логах `*.continue.*.log` | CLI не в `PATH` Next.js-процесса | Прописать абсолютный путь в `~/.bashrc` и перезапустить `npm run dev` |
| Submodule `repos/<name>` не появляется | URL приватный, нет credentials | Настроить SSH-ключ или `git credential helper` |
| Worktree creation падает в analyst-flow | `defaultBranch` не совпадает с реальной веткой upstream | В Settings указать актуальное имя ветки (`master`/`main`/...) |
| Polling watcher не стартует | Singleton-guard в `lib/watcher.ts` не сработал | Проверить `experimental.instrumentationHook: true` в `next.config.mjs` |
| Порт `3000` занят | Другой процесс | `PORT=3001 npm run dev` (Next.js подхватит переменную окружения) |

## MCP-серверы

SDD-board запускает «интеллектуальные» шаги пайплайна не напрямую, а через `gigacode --prompt`. Шаблоны промптов опираются на **MCP-серверы** (Model Context Protocol), которые должны быть зарегистрированы в окружении, из которого запускается `gigacode`.

sdd-board **не запускает** и **не настраивает** эти серверы — он только спавнит `gigacode --prompt` с нужным шаблоном. Всё, что описано ниже, касается окружения, в котором работает `gigacode`, и относится к оператору, поднимающему MCP. Если в проекте не используются submodule-репо, кнопка «Сделать pull request» или метка `sdd` — соответствующий сервер можно не поднимать.

> Секция `permissions.allow` в `settings.json` должна перечислять конкретные инструменты, которые `gigacode` имеет право вызывать. Без этого MCP зарегистрирован, но агенту будет отказано в вызове. См. раздел «[Необходимые разрешения](#необходимые-разрешения-permissions)».

### Общие требования

- `gigacode` ≥ актуальной стабильной версии с поддержкой MCP, в `PATH`.
- Конфиг MCP — `settings.json` (в `~/.gigacode/settings.json`). Каждый сервер — отдельная запись в `mcpServers` с полями `command`/`args` (stdio).
- В `args`/`command` допускаются ссылки на переменные окружения вида `$WORK` и `$HOME` — это пути к рабочему дереву MCP-серверов и домашней директории пользователя. Они должны быть определены в шелле, из которого стартует `gigacode` (например, `export WORK=/home/work/<user>/...`).
- После изменения конфига — рестарт `npm run dev`. sdd-board спавнит `gigacode` per-step, и дочерние процессы подхватывают MCP только при своём старте.

### `code-review-graph`

**Что делает.** Индексирует репозиторий в AST-aware граф (`.code-review-graph/` внутри репо) и генерирует markdown-wiki поверх него.

**Установка**:

```
uv pip install code-review-graph
```

**Настройка в settings.json**:

```json
{
  "code-review-graph": {
    "command": "<путь до директории с mcp>/.venv/bin/python",
    "args": [
      "<путь до директории с mcp>/.venv/bin/code-review-graph",
      "serve"
    ],
    "type": "stdio"
  }
}
```

**Права и команды.**

- Полный **read** на дерево исходников каждого submodule в `repos/<name>`. По умолчанию сервер читает всё репо целиком (`.gitignore`-фильтр не применяется к индексу) — индекс может быть большим.
- **Write** в `<repoRoot>/.code-review-graph/` — индекс и wiki пишутся рядом с исходниками, отдельного параметра `data_dir` у инструмента нет.
- Сетевого доступа не требует — сервер полностью локальный.
- На крупных монорепо первый build может занимать десятки минут и заметную RAM (по умолчанию пул процессов под размер машины). При необходимости ограничьте через env-переменные пакета (см. его README).
- Рекомендуется `--add-dir` с путём к submodule-репо — иначе часть инструментов может не получить к нему доступ (см. `templates/code-graph-review/build-graph.md`).

### `sourcecontrol`

**Что делает.** Создаёт pull request в git-style ремоуте (формат URL `<host>/<project>/<repository>.git`).

**Установка**:

```
git clone ssh://sc@api.sc-ci.sber.ru:7998/InSourceHub_AI/ai_market.git
```

**Настройка**:

```json
{
  "sourcecontrol": {
    "command": "node",
    "args": [
      "<путь до директории ai_market>/mcp-sourcecontrol/dist/index.js"
    ],
    "env": {
      "SC_API_URL": "https://sc-ci.sber.ru",
      "SC_TOKEN": "<SC_TOKEN>"
    }
  }
}
```

**Права и команды.**

- **Read** метаданных `<project>/<repository>`: репо существует, head/base ветки доступны.
- **Write** в репозиторий: создание PR (HEAD + body). Без права `Pull requests: Write` шаг упадёт.
- API-токен с **scope на целевой `<project>/<repository>`**. Хранить вне репозитория и прокидывать через `$secret:` или env.
- Если PR открывается от имени бота, этот бот должен быть **заранее добавлен в репозиторий** с правом открывать PR.
- Шаблон `templates/git/create-pull-request-template.md` явно запрещает fall-back на `gh` CLI / REST / `curl` — при сбое MCP ошибка должна всплысть as-is, чтобы было видно drift между sdd-board и хост-окружением.

### `jira-mcp`

**Что делает.** Применяет метку `sdd` к указанной Jira-задаче, читает и создаёт задачи.

**Установка**:

```
git clone ssh://sc@api.sc-ci.sber.ru:7998/InSourceHub_AI/ai_market.git
```

**Настройка**:

```json
{
  "jira-mcp": {
    "command": "uvx",
    "args": [
      "--python",
      "3.13",
      "--from",
      "<путь до директории с mcp>/ai_market/mcp/jira-mcp",
      "python",
      "-m",
      "jira_mcp.main",
      "--stdio"
    ],
    "env": {
      "JIRA_TOKEN": "<JIRA_TOKEN>",
      "JIRA_SERVER_URL": "https://jira.sberbank.ru"
    }
  }
}
```

**Права и команды.**

- Права **`Edit Issues`** (или эквивалент — право проставлять метки) на каждую задачу, к которой sdd-board будет применять метку.
- API-токен с доступом к нужному Jira-проекту. **Не** коммитить в репозиторий — прокидывать через `$secret:` или env.
- Шаблон `templates/jira/apply-sdd-label-template.md` запрещает fall-back на REST/`curl`, поэтому при сбое MCP нужно чинить конфиг и повторять шаг.

### Как проверить доступность

```bash
# Все три MCP должны быть видны в списке инструментов gigacode.
gigacode --list-tools 2>&1 | grep -E 'code-review-graph|sourcecontrol|jira-mcp'
```

Если какого-то сервера нет в выводе, соответствующий шаг пайплайна упадёт с `tool mcp__<server>__<tool> not found`, лог — `.sdd-board/logs/<tag>.continue.<stage>.log` (pipeline), `.sdd-board/logs/<tag>.done.update.log` (PR), `.sdd-board/logs/<tag>.done.jira-label.log` (sdd-метка), `.sdd-board/logs/repos/<repo>.graph-build.log` / `.graph-wiki.log` (code-review-graph). План действий:

1. Проверить, что MCP зарегистрирован в `settings.json` (секция `mcpServers`) и его имя **не** в `mcp.excluded`.
2. Перезапустить `npm run dev` (MCP стартуют вместе с gigacode-процессами).
3. Проверить, что нужные инструменты перечислены в `permissions.allow` (см. следующий раздел).
4. Повторить шаг: для `code-review-graph` — `POST /api/repos`, для PR — «Сделать pull request», для метки — «Поставить sdd-метку». Ручной re-raise завершённых процессов не предусмотрен.

## Необходимые разрешения (permissions)

`gigacode` использует двухуровневую систему разрешений: **MCP-инструменты** должны быть перечислены в `settings.json → permissions.allow`, иначе агенту будет отказано в их вызове даже если MCP зарегистрирован в `mcpServers`. Без соответствующих разрешений шаги пайплайна упадут с `permission denied` или `tool not allowed`.

### Минимальный набор для sdd-board

```json
{
  "permissions": {
    "allow": [
      "run_shell_command",
      "mcp__code-review-graph__build_or_update_graph_tool",
      "mcp__code-review-graph__generate_wiki_tool",
      "mcp__code-review-graph__get_minimal_context_tool",
      "mcp__code-review-graph__get_architecture_overview_tool",
      "mcp__sourcecontrol__git_create_pull_request",
      "mcp__jira-mcp__add_labels",
      "Read(*)",
      "Bash(*)"
    ]
  }
}
```

| Запись | Зачем |
| --- | --- |
| `run_shell_command` | Базовое выполнение shell-команд (`npm`, `git`, `mkdir`, ...). Без него gigacode не сможет запускать шаги пайплайна |
| `mcp__code-review-graph__build_or_update_graph_tool` | Построить/обновить AST-граф submodule-репо (стадия graph-build) |
| `mcp__code-review-graph__generate_wiki_tool` | Сгенерировать markdown-wiki поверх графа (стадия graph-wiki) |
| `mcp__code-review-graph__get_minimal_context_tool` / `get_architecture_overview_tool` | Чтение графа из prompt-стадий (обзор архитектуры, минимальный контекст) |
| `mcp__sourcecontrol__git_create_pull_request` | Открыть PR в Bitbucket-style ремоуте (кнопка «Сделать pull request») |
| `mcp__jira-mcp__add_labels` | Проставить метку `sdd` на задачу (кнопка «Поставить sdd-метку») |
| `Read(*)` | Чтение любых файлов в пределах workspace |
| `Bash(*)` | Произвольные shell-команды (используется промптами для `git`, `npm`, `mkdir` и т.д.) |

### Расширения для дополнительных MCP

Если в `mcpServers` зарегистрированы серверы, которых нет в минимальном наборе, добавьте соответствующие записи. Полный список доступных MCP-инструментов выводится через `gigacode --list-tools` — все они видны в чате как `mcp__<server>__<tool>`.

```json
{
  "permissions": {
    "allow": [
      "mcp__code-index__find_files",
      "mcp__code-index__search_code_advanced",
      "mcp__code-index__get_file_summary",
      "mcp__code-index__get_symbol_body",
      "mcp__code-index__set_project_path",
      "mcp__code-index__build_deep_index",
      "mcp__graphfocus__find_symbol",
      "mcp__graphfocus__find_semantic",
      "mcp__graphfocus__get_stats",
      "mcp__graphfocus__list_languages",
      "mcp__code-review-graph__list_repos_tool",
      "mcp__code-review-graph__list_graph_stats_tool",
      "mcp__code-review-graph__embed_graph_tool",
      "mcp__code-review-graph__semantic_search_nodes_tool",
      "mcp__code-review-graph__list_flows_tool",
      "mcp__code-review-graph__traverse_graph_tool"
    ]
  }
}
```

### Режим подтверждения

В `settings.json → tools.approvalMode` можно выставить:

- `"default"` — каждый edit требует явного подтверждения пользователем;
- `"auto-edit"` (используется в этом репозитории) — изменения файлов в рамках одной сессии применяются автоматически, ручное подтверждение не запрашивается.

Для CI/headless-сценариев и непрерывной работы пайплайна рекомендуется `"auto-edit"`.

## Два режима работы

`AppConfig.mode` — это переключатель между двумя непересекающимися наборами stages. Каждая задача принадлежит ровно одному режиму (поле `TaskEntry.mode`), режим ставится при создании и больше не меняется.

### Режим «Разработчик» (developer)

| Стадия | Назначение |
| --- | --- |
| `backlog` | Change-proposal обнаружен в `defaultBranch` (после PR merge upstream), ещё никто не взял |
| `decomposition` | Разработчик изучает change: читает proposal/design/specs, оценивает объём |
| `plan` | План готов: порядок коммитов, риски, оценка |
| `develop` | Код пишется |
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
└── repos/<repo>.graph-wiki.log
```
