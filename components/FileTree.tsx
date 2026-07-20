"use client";

import { Folder, FileText, FileCode } from "lucide-react";
import type { TreeNode } from "@/lib/openspec";

interface FileTreeProps {
  root: TreeNode;
  changeName: string;
}

function getFileIcon(name: string) {
  if (name.endsWith(".md")) return FileText;
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return FileCode;
  return FileText;
}

function TreeRow({
  node,
  changeName,
  depth,
  isLast,
  ancestors,
}: {
  node: TreeNode;
  changeName: string;
  depth: number;
  isLast: boolean;
  ancestors: boolean[];
}) {
  const Icon = node.type === "directory" ? Folder : getFileIcon(node.name);

  async function handleClick() {
    try {
      await fetch(`/api/changes/${encodeURIComponent(changeName)}/open`, {
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
        className="group flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left font-mono text-[12px] text-slate-700 hover:bg-slate-100"
      >
        <span className="shrink-0 whitespace-pre text-slate-300">
          {connectorChars}
          {currentConnector}
        </span>
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${
            node.type === "directory" ? "text-slate-500" : "text-slate-600"
          }`}
        />
        <span
          className={`shrink-0 ${
            node.type === "directory" ? "text-slate-600" : "text-slate-800"
          }`}
        >
          {node.name}
          {node.type === "directory" ? "/" : ""}
        </span>
        <span className="ml-auto shrink-0 pl-3 tabular-nums text-[10px] text-slate-400">
          {node.type === "file" ? formatSize(node.size) : ""}
        </span>
      </button>
      {node.children?.map((child, i) => (
        <TreeRow
          key={child.relativePath}
          node={child}
          changeName={changeName}
          depth={depth + 1}
          isLast={i === node.children!.length - 1}
          ancestors={[...ancestors, !isLast]}
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

export function FileTree({ root, changeName }: FileTreeProps) {
  return (
    <div className="rounded-md border border-border bg-white px-2 py-2">
      <TreeRow
        node={root}
        changeName={changeName}
        depth={0}
        isLast
        ancestors={[]}
      />
    </div>
  );
}