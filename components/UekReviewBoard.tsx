"use client";

import {
  UEK_REVIEW_COLUMNS,
  type UekReviewColumn,
  type UekReviewColumnMeta,
} from "@/lib/modes";

/**
 * The UEK-expert review board. Shows the lifecycle of pull requests
 * assigned to the current user for review:
 *
 *   Новые → В процессе → Согласовано
 *                       ↘ Отклонено
 *
 * On this iteration the data source is a static placeholder — the
 * real implementation will pull review items through the sourcecontrol
 * and bitbucket MCP servers.
 */
export interface UekReviewItem {
  id: string;
  column: UekReviewColumn;
  title: string;
  author: string;
  repository: string;
  pullRequestUrl: string;
}

const PLACEHOLDER_REVIEWS: UekReviewItem[] = [
  {
    id: "pr-1",
    column: "new",
    title: "Реализация интеграции с sberid",
    author: "ivanov@team.example",
    repository: "platform/auth",
    pullRequestUrl: "https://stash.example/projects/PLAT/repos/auth/pull-requests/1",
  },
  {
    id: "pr-2",
    column: "new",
    title: "Миграция справочников на новую версию API",
    author: "petrov@team.example",
    repository: "platform/dictionaries",
    pullRequestUrl:
      "https://stash.example/projects/PLAT/repos/dict/pull-requests/42",
  },
  {
    id: "pr-3",
    column: "in-review",
    title: "Уточнение матрицы ролей для партнёрских API",
    author: "sidorova@team.example",
    repository: "platform/security",
    pullRequestUrl:
      "https://stash.example/projects/PLAT/repos/sec/pull-requests/8",
  },
  {
    id: "pr-4",
    column: "approved",
    title: "Чистка устаревших фич-флагов в notifications",
    author: "kuznetsov@team.example",
    repository: "platform/notifications",
    pullRequestUrl:
      "https://github.com/example/platform-notifications/pull/113",
  },
  {
    id: "pr-5",
    column: "rejected",
    title: "Смена схемы БД без обратной совместимости",
    author: "orlov@team.example",
    repository: "platform/storage",
    pullRequestUrl:
      "https://stash.example/projects/PLAT/repos/storage/pull-requests/27",
  },
];

export function UekReviewBoard() {
  return (
    <div className="flex h-full flex-col gap-3 px-4 py-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[14px] font-semibold text-slate-900">
          Ревью пул-реквестов
        </h1>
        <p className="text-[11px] text-slate-500">
          На этой доске — ПР, в которых вы назначены ревьювером. Сейчас
          данные загружаются из placeholder-источника. В следующих
          итерациях подключим MCP-серверы sourcecontrol и bitbucket для
          получения реальных ПР.
        </p>
      </div>
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto scrollbar-thin">
        {(Object.keys(UEK_REVIEW_COLUMNS) as UekReviewColumn[]).map((column) => (
          <UekColumn
            key={column}
            column={column}
            meta={UEK_REVIEW_COLUMNS[column]}
            items={PLACEHOLDER_REVIEWS.filter((it) => it.column === column)}
          />
        ))}
      </div>
    </div>
  );
}

function UekColumn({
  column,
  meta,
  items,
}: {
  column: UekReviewColumn;
  meta: UekReviewColumnMeta;
  items: UekReviewItem[];
}) {
  return (
    <section
      aria-label={meta.label}
      data-column={column}
      className="flex h-full w-72 shrink-0 flex-col gap-2 rounded-md border border-border bg-white/60 p-3"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-slate-700">
          {meta.label}
        </h2>
        <span className="text-[10px] font-medium text-slate-500">
          {items.length}
        </span>
      </header>
      <p className="text-[10px] text-slate-500">{meta.description}</p>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scrollbar-thin">
        {items.length === 0 ? (
          <li className="rounded-md border border-dashed border-border bg-slate-50 px-2.5 py-3 text-[11px] text-slate-500">
            Пусто. Сюда попадут ПР с этим состоянием.
          </li>
        ) : (
          items.map((it) => (
            <li
              key={it.id}
              className="flex flex-col gap-1 rounded-md border border-border bg-white px-2.5 py-2 shadow-sm"
            >
              <a
                href={it.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-slate-900 hover:text-slate-700"
              >
                {it.title}
              </a>
              <div className="text-[10px] text-slate-500">
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                  {it.repository}
                </code>
              </div>
              <div className="text-[10px] text-slate-500">
                Автор:{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                  {it.author}
                </code>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
