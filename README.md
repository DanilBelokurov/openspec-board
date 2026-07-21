# SDD Sessions Board

UI-каркас для управления сессиями имплементации задач из OpenSpec.

Стиль вдохновлён [makeplane/plane](https://github.com/makeplane/plane) (визуальная эстетика — sidebar, board, плотные карточки), содержание — собственное: 7 колонок жизненного цикла OpenSpec-изменений.

## Стек

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** (Plane-like палитра)
- **lucide-react** (иконки)
- UI и backend — на одном порту (`3000`)

## Структура

```
sdd/
├── app/
│   ├── layout.tsx              # Корневой layout
│   ├── page.tsx                # Главная — board view
│   ├── globals.css             # Tailwind + scrollbar-стили
│   ├── changes/
│   │   └── [name]/page.tsx     # Детальная страница change-proposal (структура папки)
│   └── api/
│       ├── health/route.ts     # Backend health-stub (single port)
│       ├── config/route.ts     # GET / PUT — чтение и запись настроек
│       ├── changes/route.ts    # GET — список change-proposal из стейта
│       ├── changes/[name]/route.ts  # GET — полные данные одного change
│       ├── changes/[name]/open/route.ts  # POST — открыть в Finder (relative path внутри change)
│       └── refresh/route.ts    # POST — scan + merge в .sdd-board/state.json
├── components/
│   ├── TopBar.tsx              # Хедер: settings, refresh (refresh → POST /api/refresh + router.refresh)
│   ├── SettingsDialog.tsx      # Модалка настроек (openspecDir)
│   ├── Board.tsx               # Контейнер с 7 колонками
│   ├── Column.tsx              # Одна колонка
│   ├── SessionCard.tsx         # Карточка-линк → /changes/[changeName]
│   ├── FileTree.tsx            # Рекурсивное дерево файлов (клик → POST /api/changes/[name]/open)
│   └── CopyPathButton.tsx      # Кнопка копирования пути в буфер
├── lib/
│   ├── types.ts                # StageMeta
│   ├── mock-data.ts            # STAGES_ORDER, STAGE_META (русские лейблы)
│   ├── config.ts               # read/write .sdd-board/config.json
│   ├── state.ts                # read/write/mergeScanWithState для .sdd-board/state.json
│   └── openspec.ts             # парсеры proposal.md / design.md / specs/*.md + scanChanges / readChange + listChangeTree + formatBytes
├── docs/
│   └── sdd-directory.md        # Описание структуры OpenSpec-каталога
├── tailwind.config.ts
├── postcss.config.js
├── next.config.mjs
├── tsconfig.json
└── package.json
```

## Колонки (жизненный цикл OpenSpec-сессии)

`Backlog` → `Decomposition` → `Plan` → `Develop` → `Tests` → `Deploy` → `Done`

| Колонка | Цвет | Кол-во моков |
| --- | --- | --- |
| Backlog | slate | 2 |
| Decomposition | blue | 1 |
| Plan | violet | 1 |
| Develop | amber | 2 |
| Tests | cyan | 1 |
| Deploy | emerald | 1 |
| Done | green | 2 |

## Карточка

- ID-бейдж (`OS-001`)
- Заголовок
- Путь OpenSpec-change (`openspec/changes/<name>`)
- Цветные теги

## Запуск

```bash
npm install
npm run dev          # http://localhost:3000
```

Production-сборка:

```bash
npm run build
npm start
```

## Endpoints

| Метод | Путь | Описание |
| --- | --- | --- |
| GET | `/` | UI — board view (читает `.sdd-board/state.json`) |
| GET | `/changes/[name]` | Детальная страница change-proposal: структура папки, сводка, действия, форма «Начать» |
| GET | `/api/health` | Backend-заглушка: `{ "status": "ok", "service": "sdd-sessions-board", "time": "..." }` |
| GET | `/api/config` | Текущие настройки: `{ "openspecDir": "...", "mode": "developer"\|"analyst" }` |
| PUT | `/api/config` | Обновить настройки, тело `{ "openspecDir"?: "<абсолютный путь>", "mode"?: "developer"\|"analyst" }`. Поля опциональны — можно менять только mode |
| GET | `/api/changes` | Список tasks из state |
| GET | `/api/changes/[name]` | Полные данные одного change (с распарсенными proposal/design/specs) |
| POST | `/api/changes/[name]/open` | Открыть файл/папку в системном менеджере. Тело `{ "path": "<относительный путь>" }` (опц., пусто = корень change). 400 если path вне change-root, 404 если change не найден |
| POST | `/api/changes/[name]/start` | Запустить change: создать 2 git worktree (openspec + код), обновить state, запустить `gigacode /opsx:plan`. Тело `{ "jiraUrl": "...", "codeRepoPath": "/abs/path" }`. Возвращает `{ jiraId, openspecWorktree, codeWorktree, changePath, gigacodePid, stage }`. Только для stage=backlog, иначе 409 |
| POST | `/api/refresh` | Сканирует `openspecDir/changes/`, мерджит в `.sdd-board/state.json`. Возвращает `{ scanned, total, tasks }`. Сканирование **только** через эту кнопку |

## Настройки

Кнопка ⚙ в TopBar открывает модалку с двумя настройками:

1. **Режим доски** — переключатель «Разработчик» / «Аналитик». Сохраняется в `.sdd-board/config.json` и переживает рестарт.
2. **Директория OpenSpec store** — абсолютный путь к папке OpenSpec-стора. Сохраняется там же.

Рядом с полем «Директория OpenSpec store» есть кнопка **Browse…** (нативный фолдер-пикер через `webkitdirectory`). Браузер отдаст только имя выбранной папки, абсолютный путь нужно дописать/вставить вручную (ограничение безопасности браузера).

### Режимы доски

| Режим | Колонки |
| --- | --- |
| **Разработчик** | Бэклог → Декомпозиция → План → Разработка → Тесты → Деплой → Готово (7) |
| **Аналитик** | Намерение → Дельта-спецификация → Дизайн → ADR → Готово (5) |

Задачи с `stage`, не входящим в stages выбранного режима, скрываются с доски (но остаются в state.json). При смене режима ничего не мигрирует — это первый этап, способ «перевода» задач между режимами пока не реализован.

## Жизненный цикл задач

1. При первом открытии доски — пусто (state.json ещё нет или пуст)
2. Пользователь нажимает **Обновить** (↻ в TopBar) → `POST /api/refresh` сканирует `<openspecDir>/changes/`, мерджит в `.sdd-board/state.json` и триггерит `router.refresh()`
3. Каждый change получает стабильный `OS-NNN` (по changeName как ключ), stage = `backlog` по умолчанию
4. При повторном refresh существующие change'ы обновляют `summary` и `lastScannedAt`, новые получают следующий ID
5. После рестарта сервера state.json восстанавливается без скана — доска показывает то, что было на момент последнего refresh
6. change'ы из `archive/` пропускаются при скане

## Запуск change'а в работу

На детальной странице change'а в статусе «Бэклог» доступна форма «Начать работу» с двумя обязательными полями:

- **Jira-тикет** — полный URL (`https://acme.atlassian.net/browse/ENG-123`) или просто `ENG-123`. Извлекается `ticket-id` регуляркой
- **Путь к репозиторию с кодом** — абсолютный путь к существующему git-репо

По нажатию «Начать»:

1. Валидация (непустые поля, извлекаемый ticket-id, существующий change в backlog)
2. Создаются два git-worktree:
   - `<openspecDirParent>/<openspecDirBasename>.worktrees/<jira-id>/`
   - `<codeRepoPathParent>/<codeRepoBasename>.worktrees/<jira-id>/`
   - Оба на ветке `<jira-id>` (`-b` если ветки ещё нет)
3. Если openspec worktree создан, а code упал — openspec откатывается (`git worktree remove --force`)
4. State обновляется: `stage: "decomposition"`, сохраняются `jiraUrl`, `codeRepoPath`, пути обоих worktree, `startedAt`, `gigacodePid`
5. Спавнится `gigacode /opsx:plan <changePathInWorktree>` через `child_process.spawn` с `detached: true`. Если `gigacode` нет в PATH — поле `gigacodePid: null` и лог в console

После успешного Start:
- На карточке появляются бейджи `ENG-123` (синий) и `<repo-basename>` (серый)
- Кнопка «Начать» пропадает (заменяется блоком с путями worktree и PID gigacode)
- Повторный Start возвращает 409

## Создание proposal в режиме Аналитик

В режиме «Аналитик» в TopBar появляется кнопка **Новый proposal**. Открывает модалку с четырьмя полями:

- **Название** — заголовок proposal (человекочитаемое, может быть на любом языке)
- **Tag** (обязательно) — короткое английское название в lowercase kebab-case (например, `add-oauth2-auth`), проверяется на стороне клиента и сервера по правилам `openspec new change` (строчные латинские буквы, цифры и одиночные дефисы, начинается с буквы, без двойных дефисов, 1-40 символов). Отображается на карточке и в заголовке задачи. Передаётся как аргумент `openspec new change <tag>`
- **Краткое описание** — текст, который передаётся в gigacode /opsx-continue как содержимое proposal'а (через `--description` в `openspec new change` текст попадает в `README.md` внутри папки change)
- **Ссылка на Jira** (опционально) — URL задачи, из которого извлекается `JIRA-id` и отображается кликабельным бейджем на карточке и в заголовке детальной страницы (открывается в новой вкладке)

По нажатию «Создать»:

1. Валидация: только в режиме «Аналитик» (400 в «Разработчик»), title и description непустые. Tag обязателен — функция `isValidOpenspecTag` из `lib/tag.ts` (одинаковая на клиенте и сервере). jiraUrl опционален; если есть — извлекается ticket id (иначе 400)
2. Создаётся `TaskEntry` в state: `stage: "proposal"`, `description`, `tag`, `jiraUrl?`, `openspecNewPid: null`, `openspecNewStartedAt`
3. Спавнится `openspec new change <tag> --description <description>` через `spawnDetachedWithLog` (cwd=<openspecDir>, чтобы CLI самостоятельно нашёл корень OpenSpec через "nearest ancestor with openspec/")
4. State обновляется с `openspecNewPid`

Команда openspec создаёт директорию `<openspecDir>/changes/<tag>/` и metadata-файл `.openspec.yaml`. После этого watcher (`lib/watcher.ts`, polling 5s) или любая загрузка страницы автоматически вызывает `triggerContinueIfNeeded`, который спавнит gigacode /opsx-continue:

```
gigacode --approval-mode=auto-edit --add-dir <openspecDir> -p "/opsx-continue <description>"
```

Второй процесс получает **описание задачи** (а не путь к change), находит активный change в `--add-dir` и создаёт `proposal.md`.
5. Возвращает 201 `{ created, task, openspecCommand, openspecNewStatus }`, board перерисовывается

### Кнопка «Подтверждено» (analyst → delta-spec)

Когда оба процесса (openspec new change → gigacode /opsx-continue) завершены и `proposal.md` существует на диске, в детальной странице задачи появляется зелёная панель с кнопкой **«Подтверждено»**. По нажатию:

- POST `/api/changes/[name]/confirm` → `stage: "proposal"` → `stage: "delta-spec"`
- Кнопка скрывается (нет смысла подтверждать дважды)
- Карточка по-прежнему показывает бейдж «Ожидает» (proposal.md есть, ждём следующего шага)

Кнопка НЕ показывается, если хотя бы один gigacode завершился с ненулевым exit code (сначала разберитесь с ошибкой).

### Бейджи на карточке (по состоянию)

| Условие | Бейдж |
| --- | --- |
| `openspecNewStatus === "running"` (analyst mode, шаг 1) | `openspec new change` зелёный (Loader-спиннер) |
| `gigacodeContinueStatus === "running"` (analyst mode, шаг 2) | `gigacode /opsx-continue` зелёный (Loader-спиннер) |
| `gigacodeStatus === "running"` (developer mode, Start) | `gigacode` зелёный (Loader-спиннер) |
| `proposalReady && !gigacodeError` | `Ожидает` фиолетовый (Hourglass) |
| `gigacodeError` (любой шаг exited non-zero) | `ошибка` красный (AlertCircle) |
| `jiraUrl` задан | `JIRA-id` синий (ExternalLink) — кликабельный, открывает в новой вкладке |

В детальной странице `JIRA-id` бейдж расположен в шапке между `stage`-бейджем и `Обновлено` (как просил пользователь).

## Статус CLI-процессов (analyst + developer)

| Где | Как отображается |
| --- | --- |
| Карточка на доске | Бейдж с названием активного шага: «openspec new change», «gigacode /opsx-continue» или «gigacode» (в developer mode); Loader-спиннер пока процесс жив |
| Детальная страница — header | Бейдж «<шаг> · PID» рядом с датой |
| Детальная страница — секции процессов | Иконка + статус (выполняется/завершён), время запуска, PID, полная команда |

Статус определяется через `process.kill(pid, 0)` на каждом SSR-рендере (страница пересчитывает на refresh). Никаких polling'ов или persistent state для статуса нет — каждый refresh страницы проверяет заново.

## Что дальше

Сейчас не реализовано:

- drag&drop между колонками (все задачи остаются в той колонке, куда их переместил Start)
- рендер содержимого proposal/design/specs на детальной странице (сейчас только структура папки)
- миграция задач между режимами «Разработчик» и «Аналитик»