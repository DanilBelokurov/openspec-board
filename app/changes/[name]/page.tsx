import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { readConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import {
  listChangeTree,
  formatBytes,
  type TreeNode,
} from "@/lib/openspec";
import { FileTree } from "@/components/FileTree";
import { CopyPathButton } from "@/components/CopyPathButton";

export default async function ChangePage({
  params,
}: {
  params: { name: string };
}) {
  const state = await readState();
  const task = state.tasks[params.name];
  if (!task) notFound();

  const config = await readConfig();
  const openspecDir = config.openspecDir;
  if (!openspecDir) notFound();

  const changePath = `${openspecDir}/changes/${params.name}`;
  const tree = await listChangeTree(changePath);
  const fileCount = countFiles(tree);
  const totalSize = tree.size;
  const lastScanned = new Date(task.lastScannedAt);
  const dateStr = lastScanned.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const relPath = `openspec/changes/${task.summary.changeName}`;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <div className="flex h-12 shrink-0 items-center border-b border-border bg-surface-raised px-4">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Назад к доске</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-4xl px-8 py-6">
          <header className="mb-5">
            <h1 className="text-[20px] font-semibold leading-tight text-slate-900">
              {task.summary.title}
            </h1>
            <code className="mt-1 block text-[12px] text-slate-500">
              {relPath}
            </code>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                {task.id}
              </span>
              <span>·</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                {task.stage}
              </span>
              <span>·</span>
              <span>Обновлено {dateStr}</span>
            </div>
          </header>

          <section className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            Структура
          </section>
          <FileTree root={tree} changeName={task.summary.changeName} />

          <div className="mt-5 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600">
            <span className="font-semibold text-slate-800">
              {fileCount} {pluralFiles(fileCount)}
            </span>
            <span className="text-slate-400"> · </span>
            <span>{formatBytes(totalSize)}</span>
            <span className="text-slate-400"> · </span>
            <span>
              {task.summary.newCapabilities.length} new,{" "}
              {task.summary.modifiedCapabilities.length} modified capabilities
            </span>
          </div>

          <div className="mt-3 flex gap-2">
            <OpenInFinderForm changeName={task.summary.changeName} />
            <CopyPathButton path={relPath} />
          </div>
        </div>
      </div>
    </div>
  );
}

function countFiles(node: TreeNode): number {
  if (node.type === "file") return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, c) => sum + countFiles(c), 0);
}

function pluralFiles(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "файл";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "файла";
  return "файлов";
}

function OpenInFinderForm({ changeName }: { changeName: string }) {
  return (
    <form
      action={`/api/changes/${encodeURIComponent(changeName)}/open`}
      method="post"
    >
      <button
        type="submit"
        className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span>Открыть в Finder</span>
      </button>
    </form>
  );
}