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
│   └── api/health/route.ts     # Backend-заглушка (single port)
├── components/
│   ├── TopBar.tsx              # Хедер: New session, settings (dropdown), refresh
│   ├── Board.tsx               # Контейнер с 7 колонками
│   ├── Column.tsx              # Одна колонка
│   └── SessionCard.tsx         # Карточка сессии
├── lib/
│   ├── types.ts                # Session, Stage, Priority, Label, Assignee
│   └── mock-data.ts            # 10 мок-сессий, распределённых по колонкам
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
| GET | `/` | UI — board view |
| GET | `/api/health` | Backend-заглушка: `{ "status": "ok", "service": "sdd-sessions-board", "time": "..." }` |

## Что дальше

Это визуальный каркас — без интерактива, без drag&drop, без CRUD. Мок-данные лежат в `lib/mock-data.ts`. Следующие шаги по запросу:

- drag&drop между колонками (`@dnd-kit/core`)
- API `GET /api/sessions`, `PATCH /api/sessions/:id/stage`
- Чтение реальных `openspec/changes/*` с диска
- SQLite-персистентность через Prisma
- Детальная страница сессии с proposal/design/tasks