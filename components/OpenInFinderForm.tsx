"use client";

import { FolderOpen } from "lucide-react";

interface OpenInFinderFormProps {
  tag: string;
}

/**
 * Client wrapper around POST /api/changes/<tag>/open. The endpoint
 * runs the OS-level `open` syscall as a side-effect and returns
 * JSON — so a native <form action=…> would replace the page with
 * that JSON. This button calls fetch() instead and stays on the
 * current page.
 */
export function OpenInFinderForm({ tag }: OpenInFinderFormProps) {
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await fetch(
            `/api/changes/${encodeURIComponent(tag)}/open`,
            { method: "POST" },
          );
        } catch {
          /* ignore — the native 'open' call already fired */
        }
      }}
      className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
    >
      <FolderOpen className="h-3.5 w-3.5" />
      <span>Открыть в Finder</span>
    </button>
  );
}