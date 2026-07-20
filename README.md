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
| GET | `/changes/[name]` | Детальная страница change-proposal: структура папки, сводка, действия |
| GET | `/api/health` | Backend-заглушка: `{ "status": "ok", "service": "sdd-sessions-board", "time": "..." }` |
| GET | `/api/config` | Текущие настройки: `{ "openspecDir": "..." }` |
| PUT | `/api/config` | Обновить настройки, тело `{ "openspecDir": "<абсолютный путь>" }` |
| GET | `/api/changes` | Список tasks из state |
| GET | `/api/changes/[name]` | Полные данные одного change (с распарсенными proposal/design/specs) |
| POST | `/api/changes/[name]/open` | Открыть файл/папку в системном менеджере. Тело `{ "path": "<относительный путь>" }` (опц., пусто = корень change). Возвращает `{ opened, path }`. 400 если path вне change-root, 404 если change не найден |
| POST | `/api/refresh` | Сканирует `openspecDir/changes/`, мерджит в `.sdd-board/state.json`. Возвращает `{ scanned, total, tasks }`. Сканирование **только** через эту кнопку |

## Настройки

Кнопка ⚙ в TopBar открывает модалку с единственной настройкой — `OpenSpec store directory` (абсолютный путь к папке OpenSpec-стора). Значение сохраняется в `.sdd-board/config.json` в корне проекта (папка гитигнорится) и переживает рестарт.

Поле ввода поддерживает ручной ввод; рядом кнопка **Browse…** открывает нативный фолдер-пикер (`webkitdirectory`) — браузер отдаст только имя выбранной папки, абсолютный путь нужно дописать/вставить вручную (ограничение безопасности браузера).

## Жизненный цикл задач

1. При первом открытии доски — пусто (state.json ещё нет или пуст)
2. Пользователь нажимает **Обновить** (↻ в TopBar) → `POST /api/refresh` сканирует `<openspecDir>/changes/`, мерджит в `.sdd-board/state.json` и триггерит `router.refresh()`
3. Каждый change получает стабильный `OS-NNN` (по changeName как ключ), stage = `backlog` по умолчанию
4. При повторном refresh существующие change'ы обновляют `summary` и `lastScannedAt`, новые получают следующий ID
5. После рестарта сервера state.json восстанавливается без скана — доска показывает то, что было на момент последнего refresh
6. change'ы из `archive/` пропускаются при скане

## Что дальше

Карточка на доске → детальная страница со структурой папки, сводкой и действиями «Открыть в Finder» / «Скопировать путь». Клик по любому узлу дерева открывает его в стандартном файловом менеджере через `POST /api/changes/[name]/open`.

Сейчас не реализовано: drag&drop между колонками (stage у всех `backlog`), визуализация содержимого спек внутри детальной страницы (сейчас только структура папки). Следующие шаги по запросу:

- drag&drop между колонками с записью нового stage в `state.json`
- рендер содержимого proposal/design/specs на детальной странице (Markdown-вкладки)