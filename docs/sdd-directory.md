# Структура директории OpenSpec спецификаций

Документ описывает каноническую раскладку каталога `openspec/` по состоянию проекта [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec).

## 1. Общий layout

```
project-root/
├── AGENTS.md           # Инструкции для AI-ассистентов: как работать с OpenSpec в этом проекте
└── openspec/
    ├── specs/          # Актуальные (кумулятивные) спецификации — source of truth
    └── changes/        # Предлагаемые / активные / архивные изменения
        ├── <change-name>/
        └── archive/    # Завершённые изменения
            └── YYYY-MM-DD-<change-name>/
```

Ключевая идея: `openspec/` живёт в корне репозитория, `AGENTS.md` — рядом с ним. Никакого проектного `openspec.json` нет, конфигурация управляется глобальным CLI (`openspec init`, `openspec update`, `openspec config profile`).

## 2. `openspec/specs/` — кумулятивные требования

Это **источник истины** по возможностям проекта. Файлы — обычный Markdown со структурой:

```
## ADDED Requirements
### Requirement: <name>
The system SHALL ...

#### Scenario: <situation>
- **WHEN** <condition>
- **THEN** <expected outcome>
```

Особенности:

- Никаких новых синтаксисов — только Markdown с заголовками `Requirement:` и `Scenario:` и пунктами `WHEN` / `THEN`.
- Содержимое здесь — это уже принятое (после архивации change'а). До этого момента правки существуют как delta в `changes/<change-name>/specs/`.

## 3. `openspec/changes/<change-name>/` — артефакты одного изменения

Каждое предлагаемое изменение лежит в собственной папке и состоит из четырёх артефактов:

```
openspec/changes/add-dark-mode/
├── proposal.md   # Зачем делаем, что меняется
├── specs/        # Delta-спецификации (ADDED / MODIFIED / REMOVED Requirements + сценарии)
├── design.md     # Технический подход и архитектурные решения
└── tasks.md      # Чек-лист реализации, сгруппированный по фазам (1.1, 1.2, 2.1, …)
```

### 3.1. Назначение файлов

| Файл | Назначение |
| --- | --- |
| `proposal.md` | «Почему» — мотивация, scope, краткое summary того, что меняется |
| `specs/` | Папка с delta-спецификациями в формате `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements` плюс конкретные `Scenario:` с `WHEN`/`THEN` |
| `design.md` | Технический подход, архитектурные решения, обоснования |
| `tasks.md` | Нумерованный чек-лист реализации (фазы/секции вида `1.1`, `1.2`, `2.1`, `2.2`) |

### 3.2. Соглашения об именовании

- Папки изменений — **kebab-case**: `add-dark-mode`, `two-word-summary`.
- При архивации (команда `/opsx:archive`) папка переезжает в `openspec/changes/archive/` с **дато-префиксом**: `YYYY-MM-DD-<change-name>/` (например, `2025-01-23-add-dark-mode/`).

### 3.3. Жизненный цикл change'а

1. Создаётся папка `openspec/changes/<change-name>/` с `proposal.md`, `design.md`, `tasks.md` и `specs/` с delta.
2. Change проходит ревью/применение — контент из `changes/<change-name>/specs/` мерджится в `openspec/specs/`.
3. Папка изменения переезжает в `openspec/changes/archive/YYYY-MM-DD-<change-name>/` для истории.

## 4. Конфигурация

- **`AGENTS.md`** в корне репозитория — файл, который AI-кодинг-ассистенты читают, чтобы понять, как OpenSpec применяется в этом конкретном проекте. Обновляется командой `openspec update`.
- **Глобальный CLI `openspec`** — управление инициализацией (`init`), обновлением (`update`), профилем (`config profile`). Проектного файла конфигурации в дереве нет.

## 5. Store — мульти-репозиторный вариант

Для кросс-командного / кросс-репозиторного планирования OpenSpec предлагает **Store** (бета) — отдельный репозиторий, который использует ту же форму `openspec/` (папки `specs/` и `changes/`) и расшаривается через `git push`. Несколько coding-агентов в разных репах читают один источник истины по возможностям.

## 6. Сводная шпаргалка по путям

| Путь | Что внутри |
| --- | --- |
| `openspec/specs/*.md` | Кумулятивные принятые требования |
| `openspec/changes/<name>/proposal.md` | Зачем и что меняется |
| `openspec/changes/<name>/design.md` | Технический подход |
| `openspec/changes/<name>/tasks.md` | Чек-лист реализации |
| `openspec/changes/<name>/specs/*.md` | Delta-спецификации (ADDED/MODIFIED/REMOVED) |
| `openspec/changes/archive/YYYY-MM-DD-<name>/` | Завершённые изменения |
| `AGENTS.md` (корень репо) | Инструкции для AI-агентов по работе с OpenSpec |