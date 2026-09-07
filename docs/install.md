# Установка и запуск sdd-sessions-board

Доска жизненного цикла change-proposal в экосистеме OpenSpec. Один Next.js-инстанс работает в одном из двух режимов: **«Разработчик»** (имплементация уже утверждённых change) или **«Аналитик»** (подготовка proposal через gigacode).

## 1. Системные требования

| Компонент | Версия | Зачем |
|---|---|---|
| Node.js | ≥ 18.17 (рекомендуется 20 LTS) | Сборка и запуск Next.js 14 |
| npm | ≥ 9 | Менеджер зависимостей |
| Git | ≥ 2.30 | `worktree`, `submodule`, `push`, ветки `feature/<JiraID>` |
| gigacode CLI | актуальный | LLM-агент для proposal/specs/design/adr/PR (должен быть в `PATH`) |
| OpenSpec-store | локальный git-репо | Целевой репозиторий с директорией `openspec/` |

## 2. Установка

```bash
git clone <repo-url> openspec-board
cd openspec-board
npm install
```

Проверка окружения:

```bash
node -v         # >= 18.17
git --version   # >= 2.30
which gigacode  # должен вернуть путь к CLI
```

### 2.1. Интерактивный установщик harness-окружения

В корне проекта есть `scripts/install.sh`. Он:

- выводит информационный блок о составе harness-окружения;
- запрашивает токен Jira в скрытом режиме и атомарно добавляет `jira-mcp` в `~/.gigacode/settings.json`;
- прописывает `mcp__jira-mcp__add_labels` в `permissions.allow`;
- предлагает выбор режима работы стрелками (`Аналитик/разработчик` или `Эксперт УЭК`).

```bash
./scripts/install.sh
```

## 3. MCP-серверы

Доска спавнит `gigacode --prompt` per-step; сами MCP она не поднимает — только передаёт нужные инструменты агенту. Конфиг — в `~/.gigacode/settings.json` (секция `mcpServers`).

| Сервер | Обязателен? | Назначение |
|---|---|---|
| `code-review-graph` | нет (нужен для кнопки «обновить код-граф» в subtask-режиме) | AST-aware индекс submodule-репо + markdown-wiki |
| `sourcecontrol` | нет (нужен только если открываете PR через UI) | Создание pull request в git-style ремоуте |
| `jira-mcp` | нет (нужен только для метки `sdd`) | Чтение/создание Jira-задач + простановка меток |

Минимальный шаблон `settings.json`:

```json
{
  "permissions": {
    "allow": [
      "run_shell_command",
      "Read(*)",
      "Bash(*)"
    ]
  },
  "tools": { "approvalMode": "auto-edit" }
}
```

Дополнительные `mcp__*` записи добавляются по необходимости (полный список доступных инструментов: `gigacode --list-tools`).

### Свой сервер `code-review-graph`

```bash
uv pip install code-review-graph
```

```json
{
  "code-review-graph": {
    "command": "<путь до .venv>/bin/python",
    "args": ["<путь до .venv>/bin/code-review-graph", "serve"],
    "type": "stdio"
  }
}
```

Права: read всего дерева submodule-репо, write в `<repoRoot>/.code-review-graph/`. Сетевого доступа не требует. На крупном монорепо первый build может занимать десятки минут — ограничьте пул процессов env-переменными пакета при необходимости.

### Свои серверы `sourcecontrol` и `jira-mcp`

Оба живут в одном моно-репо `ai_market`. Токены (`SC_TOKEN`, `JIRA_TOKEN`) прокидываются через env, **не коммитятся** в репозиторий. URL ремоутов и Jira-сервера — также через env.

#### `sourcecontrol`

Создаёт pull request в git-style ремоуте формата `<host>/<project>/<repository>.git`. Кнопка «Сделать pull request» в UI вызывает `mcp__sourcecontrol__git_create_pull_request` через gigacode.

**Установка:**

```bash
git clone ssh://sc@api.sc-ci.sber.ru:7998/InSourceHub_AI/ai_market.git
```

**`settings.json`:**

```json
{
  "sourcecontrol": {
    "command": "node",
    "args": [
      "<путь до ai_market>/mcp-sourcecontrol/dist/index.js"
    ],
    "env": {
      "SC_API_URL": "https://sc-ci.sber.ru",
      "SC_TOKEN": "<SC_TOKEN>"
    }
  }
}
```

**Права и требования:**

- **Read** метаданных `<project>/<repository>` — репо существует, head/base ветки доступны.
- **Write** — создание PR (HEAD + body). Без `Pull requests: Write` шаг упадёт.
- API-токен со **scope на целевой `<project>/<repository>`**. Хранить вне репозитория.
- Если PR открывается от имени бота, этот бот должен быть **заранее добавлен** в репозиторий с правом открывать PR.
- Шаблон `templates/git/create-pull-request-template.md` явно запрещает fall-back на `gh` CLI / REST / `curl` — при сбое MCP ошибка должна всплывать as-is, чтобы было видно drift между sdd-board и хост-окружением.

#### `bitbucket` (Stash / Bitbucket Server)

Для remote-ссылок с hostname, содержащим `stash`, используется `mcp__bitbucket__create_pull_request` из [bitbucket-mcp](https://github.com/MatanYemini/bitbucket-mcp). Зарегистрируйте сервер `bitbucket` в `settings.json`, добавьте этот инструмент в `permissions.allow` и задайте `BITBUCKET_URL` / `BITBUCKET_TOKEN` через env. Совместимость endpoint `/rest/api/1.0` с вашей версией Stash/Bitbucket Server нужно проверить отдельно.

Шаблон для этого пути: `templates/git/create-stash-pull-request-template.md`.

#### `jira-mcp`

Применяет метку `sdd` к указанной Jira-задаче, читает и создаёт задачи. Кнопка «Поставить sdd-метку» в UI вызывает `mcp__jira-mcp__add_labels` через gigacode.

**Установка:**

```bash
git clone ssh://sc@api.sc-ci.sber.ru:7998/InSourceHub_AI/ai_market.git
```

**`settings.json`:**

```json
{
  "jira-mcp": {
    "command": "uvx",
    "args": [
      "--python", "3.13",
      "--from", "<путь до ai_market>/ai_market/mcp/jira-mcp",
      "python", "-m", "jira_mcp.main", "--stdio"
    ],
    "env": {
      "JIRA_TOKEN": "<JIRA_TOKEN>",
      "JIRA_SERVER_URL": "https://jira.sberbank.ru"
    }
  }
}
```

**Права и требования:**

- Права **`Edit Issues`** (или эквивалент — право проставлять метки) на каждую задачу, к которой sdd-board будет применять метку.
- API-токен с доступом к нужному Jira-проекту. **Не** коммитить в репозиторий.
- Шаблон `templates/jira/apply-sdd-label-template.md` запрещает fall-back на REST/`curl`, поэтому при сбое MCP нужно чинить конфиг и повторять шаг.

### Проверка доступности MCP

После настройки всех нужных серверов — проверьте, что `gigacode` их видит:

```bash
gigacode --list-tools 2>&1 | grep -E 'code-review-graph|sourcecontrol|jira-mcp'
```

Если какого-то сервера нет в выводе:

1. Проверьте, что MCP зарегистрирован в `settings.json` (`mcpServers`) и его имя **не** в `mcp.excluded`.
2. Перезапустите `npm run dev` — MCP поднимаются вместе с gigacode-процессами.
3. Проверьте, что нужные инструменты перечислены в `permissions.allow`.
4. Повторите шаг: для `code-review-graph` — `POST /api/repos`, для PR — «Сделать pull request», для метки — «Поставить sdd-метку».

## 4. Первый запуск

```bash
npm run dev
# → http://localhost:3000
```

При первом открытии:

1. **⚙ в TopBar → Настройки** → заполните:
   - **Директория OpenSpec store** — абсолютный путь к репо с `openspec/` (`<repo>/openspec/`).
   - **Главная ветка** — `master`/`main`/... (по умолчанию `master`).
   - **Режим доски** — «Разработчик» или «Аналитик».
   - **Идентификация** — email + displayName (для фильтра «Мои / Чужие» и бейджа автора на чужих proposal'ах). Авто-подстановка из `git config user.email`.
2. **(Опционально)** добавьте submodule-репо через «+» в секции «Репозитории».
3. Нажмите **↻** в TopBar — задачи появятся на доске.

## 5. Production-сборка

```bash
npm run build
npm start          # порт 3000
```

Логи detached-процессов пишутся в `.sdd-board/logs/` (submodule-build, watcher-tick, PR, push, jira-label).

## 6. Переменные окружения

| Переменная | Назначение |
|---|---|
| `PORT` | Переопределяет дефолтный `3000` (например, `PORT=3001 npm run dev`). |
| `WORK`, `HOME` | Пути, на которые ссылаются `args`/`command` MCP-серверов (для stdio-конфигов, которые их используют). |
| `SC_TOKEN`, `SC_API_URL` | Sourcecontrol MCP — токен и URL ремоута. |
| `JIRA_TOKEN`, `JIRA_SERVER_URL` | Jira MCP — токен и URL инстанса. |

Все секреты — только через env или `$secret:`-ссылки в `settings.json`. Никогда не коммитьте.

## 7. Типичные проблемы

| Симптом | Причина | Решение |
|---|---|---|
| `gigacode: command not found` в `*.continue.*.log` | CLI не в `PATH` Next.js-процесса | Прописать абсолютный путь в `~/.bashrc` и перезапустить `npm run dev` |
| Submodule `.sdd-board/repos/<name>` не появляется | URL приватный, нет credentials | Настроить SSH-ключ или `git credential helper` |
| Worktree creation падает в analyst-flow | `defaultBranch` не совпадает с реальной веткой upstream | В Settings указать актуальное имя ветки |
| Polling watcher не стартует | `experimental.instrumentationHook` отключён | Проверить `next.config.mjs` |
| Порт `3000` занят | Другой процесс | `PORT=3001 npm run dev` |
| `tool mcp__<server>__<tool> not found` | MCP зарегистрирован, но инструмент не в `permissions.allow` | Добавить инструмент в `~/.gigacode/settings.json → permissions.allow` и перезапустить `npm run dev` |
| Чужие proposal'ы не появляются | `mode !== "analyst"` или `remoteScanIntervalMinutes === 0` | Переключить режим в Settings или подождать очередного scan / нажать ↻ |

## 8. Дальнейшие шаги

- **README.md** — расширенное описание двух режимов, полей `TaskEntry`, lifecycle стадий (`proposal → delta-spec → design → adr → done`).
- **templates/** — готовые gigacode-промпты по стадиям. Шаблоны рассчитаны на стандартную OpenSpec-разметку и конвенцию веток `feature/<JiraID>`.

Установка завершена, когда `npm run dev` показывает доску без красных бэннеров и `↻` возвращает `200 OK` со списком задач.