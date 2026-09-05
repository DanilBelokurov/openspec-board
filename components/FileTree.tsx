"use client";

import { Folder, FileText, FileCode } from "lucide-react";
import type { TreeNode } from "@/lib/openspec";

interface FileTreeProps {
  root: TreeNode;
  tag: string;
  /**
   * Relative paths (under the change folder) that should be
   * marked stale with a `(*)` suffix — used to surface
   * artefacts that were left untouched by a cascade-update and
   * may no longer match the latest upstream artefacts.
   * Paths can match either a file or a directory.
   */
  stalePaths?: string[];
  /**
   * When true, nodes are rendered inert (no "open in Finder"
   * action). Used for remote tasks whose files live only in git,
   * not on the local filesystem — clicking a node has nothing to
   * open, so the row is just a plain label.
   */
  readOnly?: boolean;
}

function getFileIcon(name: string) {
  if (name.endsWith(".md")) return FileText;
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return FileCode;
  return FileText;
}

/** Normalise separators so Windows-style "\" still matches.
 *  Relative paths from listChangeTree use POSIX "/". */
function normalise(p: string): string {
  return p.replace(/\\/g, "/");
}

function TreeRow({
  node,
  tag,
  depth,
  isLast,
  ancestors,
  stalePaths,
  readOnly,
}: {
  node: TreeNode;
  tag: string;
  depth: number;
  isLast: boolean;
  ancestors: boolean[];
  stalePaths: string[];
  readOnly: boolean;
}) {
  const Icon = node.type === "directory" ? Folder : getFileIcon(node.name);

  async function handleClick() {
    try {
      await fetch(`/api/changes/${encodeURIComponent(tag)}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: node.relativePath }),
      });
    } catch (e) {
      console.error("open failed:", e);
    }
  }

  const connectorChars = ancestors
    .map((hasMore) => (hasMore ? "│   " : "    "))
    .join("");
  const currentConnector =
    depth === 0 ? "" : isLast ? "└── " : "├── ";

  const isStale = stalePaths.some(
    (p) => normalise(p) === normalise(node.relativePath),
  );

  const labelClass =
    isStale
      ? "text-amber-700"
      : node.type === "directory"
        ? "text-slate-600"
        : "text-slate-800";
  const rowClass =
    "group flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left font-mono text-[12px] text-slate-700";
  const iconClass = `h-3.5 w-3.5 shrink-0 ${
    node.type === "directory" ? "text-slate-500" : "text-slate-600"
  }`;

  if (readOnly) {
    return (
      <>
        <div
          className={rowClass}
          title={
            node.type === "directory"
              ? `${node.name}/ — файлы задачи находятся только в git (remote)`
              : `${node.name} — файл задачи находится только в git (remote)`
          }
        >
          <span className="shrink-0 whitespace-pre text-slate-300">
            {connectorChars}
            {currentConnector}
          </span>
          <Icon className={iconClass} />
          <span className={`shrink-0 ${labelClass}`}>
            {node.name}
            {node.type === "directory" ? "/" : ""}
            {isStale && (
              <span
                className="ml-1 rounded bg-amber-100 px-1 font-sans text-[10px] font-medium text-amber-800"
                title="Артефакт устарел из-за каскадного обновления — обновите вручную или подтвердите как есть"
              >
                (*)
              </span>
            )}
          </span>
          <span className="ml-auto shrink-0 pl-3 tabular-nums text-[10px] text-slate-400">
            {node.type === "file" ? formatSize(node.size) : ""}
          </span>
        </div>
        {node.children?.map((child, i) => (
          <TreeRow
            key={child.relativePath}
            node={child}
            tag={tag}
            depth={depth + 1}
            isLast={i === node.children!.length - 1}
            ancestors={[...ancestors, !isLast]}
            stalePaths={stalePaths}
            readOnly
          />
        ))}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={
          node.type === "directory"
            ? `Открыть ${node.name}/ в Finder`
            : `Открыть ${node.name} в стандартном приложении`
        }
        className={rowClass}
      >
        <span className="shrink-0 whitespace-pre text-slate-300">
          {connectorChars}
          {currentConnector}
        </span>
        <Icon className={iconClass} />
        <span className={`shrink-0 ${labelClass}`}>
          {node.name}
          {node.type === "directory" ? "/" : ""}
          {isStale && (
            <span
              className="ml-1 rounded bg-amber-100 px-1 font-sans text-[10px] font-medium text-amber-800"
              title="Артефакт устарел из-за каскадного обновления — обновите вручную или подтвердите как есть"
            >
              (*)
            </span>
          )}
        </span>
        <span className="ml-auto shrink-0 pl-3 tabular-nums text-[10px] text-slate-400">
          {node.type === "file" ? formatSize(node.size) : ""}
        </span>
      </button>
      {node.children?.map((child, i) => (
        <TreeRow
          key={child.relativePath}
          node={child}
          tag={tag}
          depth={depth + 1}
          isLast={i === node.children!.length - 1}
          ancestors={[...ancestors, !isLast]}
          stalePaths={stalePaths}
          readOnly={false}
        />
      ))}
    </>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileTree({ root, tag, stalePaths = [], readOnly = false }: FileTreeProps) {
  return (
    <div className="rounded-md border border-border bg-white px-2 py-2">
      <TreeRow
        node={root}
        tag={tag}
        depth={0}
        isLast
        ancestors={[]}
        stalePaths={stalePaths}
        readOnly={readOnly}
      />
    </div>
  );
}