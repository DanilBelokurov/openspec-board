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
│   └── api/
│       ├── health/route.ts     # Backend health-stub (single port)
│       ├── config/route.ts     # GET / PUT — чтение и запись настроек
│       ├── changes/route.ts    # GET — список change-proposal из стейта
│       ├── changes/[name]/route.ts  # GET — полные данные одного change
│       └── refresh/route.ts    # POST — scan + merge в .sdd-board/state.json
├── components/
│   ├── TopBar.tsx              # Хедер: New session, settings, refresh (refresh → POST /api/refresh + router.refresh)
│   ├── SettingsDialog.tsx      # Модалка настроек (openspecDir)
│   ├── Board.tsx               # Контейнер с 7 колонками
│   ├── Column.tsx              # Одна колонка
│   └── SessionCard.tsx         # Карточка: title + changeName
├── lib/
│   ├── types.ts                # StageMeta
│   ├── mock-data.ts            # STAGES_ORDER, STAGE_META (русские лейблы)
│   ├── config.ts               # read/write .sdd-board/config.json
│   ├── state.ts                # read/write/mergeScanWithState для .sdd-board/state.json
│   └── openspec.ts             # парсеры proposal.md / design.md / specs/*.md + scanChanges / readChange
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
| GET | `/api/health` | Backend-заглушка: `{ "status": "ok", "service": "sdd-sessions-board", "time": "..." }` |
| GET | `/api/config` | Текущие настройки: `{ "openspecDir": "..." }` |
| PUT | `/api/config` | Обновить настройки, тело `{ "openspecDir": "<абсолютный путь>" }` |
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

Сейчас каркас без интерактива: задачи попадают на доску только через кнопку Обновить, stage у всех `backlog`, drag&drop и ручная смена колонки не реализованы. Следующие шаги по запросу:

- drag&drop между колонками с записью нового stage в `state.json`
- детальная страница `/changes/[name]` с табами Описание / Спека / Дизайн (read-only рендер Markdown)
- кнопка «Новая сессия» (сейчас только визуальная)