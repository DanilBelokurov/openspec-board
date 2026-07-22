import { execFile } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { readConfig, writeConfig } from "@/lib/config";
import { isGitRepo } from "@/lib/git";

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts?.cwd, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `${cmd} ${args.join(" ")} failed: ${err.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { name: string } },
) {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }
  const name = params.name;
  const repos = config.repos ?? {};
  if (!repos[name]) {
    return NextResponse.json(
      { error: `Репозиторий "${name}" не найден в настройках` },
      { status: 404 },
    );
  }

  // Best-effort: de-register the submodule on disk. If git
  // isn't available or the repo isn't a git repo, just drop the
  // entry from config.
  if (await isGitRepo(config.openspecDir)) {
    try {
      await run(
        "git",
        [
          "-C",
          config.openspecDir,
          "submodule",
          "deinit",
          "-f",
          path.posix.join("repos", name),
        ],
        { cwd: config.openspecDir },
      );
    } catch (e) {
      console.warn(`git submodule deinit for ${name} failed:`, e);
    }
    try {
      await run(
        "git",
        [
          "-C",
          config.openspecDir,
          "submodule",
          "rm",
          "-f",
          path.posix.join("repos", name),
        ],
        { cwd: config.openspecDir },
      );
    } catch (e) {
      console.warn(`git submodule rm for ${name} failed:`, e);
    }
  }

  const next = { ...repos };
  delete next[name];
  const updated = await writeConfig({ repos: next });
  return NextResponse.json({ ok: true, repos: updated.repos });
}