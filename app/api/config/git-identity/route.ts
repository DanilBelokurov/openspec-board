/**
 * Read git's `user.email` / `user.name` from the configured
 * openspecDir. The Settings dialog uses this to auto-fill the
 * "Идентификация" fields on first open — the user only has to
 * confirm or correct them.
 *
 * We run `git config --get` against the openspecDir repo (NOT the
 * sdd-board repo) because that's where the user's feature-branch
 * work happens and where commits to openspec/changes/* are
 * authored. Falls back to global git config (`--global`) when
 * the repo-local value is unset.
 *
 * Returns:
 *   { email: string|null, name: string|null, source: "repo"|"global"|null }
 *
 * `source` is exposed for the UI to show a hint like "from repo
 * config" vs "from global config" so the user knows which one
 * they're getting. `null` means git config returned nothing on
 * either scope.
 */

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { readConfig } from "@/lib/config";
import { isGitRepo } from "@/lib/git";

function readGitConfig(
  cwd: string | null,
  key: "user.email" | "user.name",
): Promise<string | null> {
  return new Promise((resolve) => {
    const args = cwd
      ? ["-C", cwd, "config", "--get", key]
      : ["config", "--global", "--get", key];
    execFile("git", args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        // git returns exit code 1 when the key is unset — that's
        // normal, not an error. Anything else (ENOENT, permission,
        // etc.) we surface as null but don't crash the route.
        resolve(null);
        return;
      }
      const value = String(stdout).trim();
      resolve(value || null);
    });
  });
}

export async function GET() {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }

  if (!(await isGitRepo(config.openspecDir))) {
    return NextResponse.json(
      { error: `Директория не является git-репозиторием: ${config.openspecDir}` },
      { status: 400 },
    );
  }

  // Repo-local first, then global as fallback.
  const emailFromRepo = await readGitConfig(config.openspecDir, "user.email");
  const nameFromRepo = await readGitConfig(config.openspecDir, "user.name");
  const email = emailFromRepo ?? (await readGitConfig(null, "user.email"));
  const name = nameFromRepo ?? (await readGitConfig(null, "user.name"));

  const source: "repo" | "global" | null = emailFromRepo || nameFromRepo
    ? "repo"
    : email || name
      ? "global"
      : null;

  return NextResponse.json({ email, name, source });
}
