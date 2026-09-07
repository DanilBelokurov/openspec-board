import { commandExists, runCommand } from "./shell";
import { print } from "./print";

export interface OpenspecProbe {
  present: boolean;
  binary?: string;
  version?: string;
}

export interface OpenspecResolution extends OpenspecProbe {
  installedNow: boolean;
}

export interface InstallAttempt {
  label: string;
  bin: string;
  args: string[];
}

export const DEFAULT_OPENSPEC_INSTALL_ATTEMPTS: InstallAttempt[] = [
  {
    label: "npm install -g @fission-ai/openspec",
    bin: "npm",
    args: ["install", "-g", "@fission-ai/openspec"],
  },
  {
    label: "brew install openspec",
    bin: "brew",
    args: ["install", "openspec"],
  },
];

export function probeOpenspec(): OpenspecProbe {
  if (!commandExists("openspec")) {
    return { present: false };
  }
  const result = runCommand("openspec", ["--version"], { stdio: "pipe" });
  if (result.status !== 0) {
    return { present: true, binary: "openspec" };
  }
  const stream = (result.stdout || result.stderr || "").trim();
  const firstLine = stream.split("\n", 1)[0]?.trim() ?? "";
  return {
    present: true,
    binary: "openspec",
    version: firstLine || undefined,
  };
}

export type ProbeFn = () => OpenspecProbe;
export type HasBinaryFn = (bin: string) => boolean;
export type SpawnFn = (
  bin: string,
  args: string[],
) => Promise<number | null> | number | null;

async function defaultSpawn(
  bin: string,
  args: string[],
): Promise<number | null> {
  const result = runCommand(bin, args, { stdio: "inherit" });
  return result.status ?? 1;
}

export interface EnsureOpenspecOptions {
  probe?: ProbeFn;
  attempts?: InstallAttempt[];
  hasBinary?: HasBinaryFn;
  spawn?: SpawnFn;
}

export async function ensureOpenspec(
  options: EnsureOpenspecOptions = {},
): Promise<OpenspecResolution> {
  const probe = options.probe ?? probeOpenspec;
  const attempts = options.attempts ?? DEFAULT_OPENSPEC_INSTALL_ATTEMPTS;
  const hasBinary = options.hasBinary ?? commandExists;
  const spawnImpl = options.spawn ?? defaultSpawn;

  const initial = probe();
  if (initial.present) {
    return { ...initial, installedNow: false };
  }

  print.info("openspec не найден — попытка установить.");

  for (const attempt of attempts) {
    if (!hasBinary(attempt.bin)) {
      print.dim(`Пропускаю «${attempt.label}» — нет ${attempt.bin} в PATH.`);
      continue;
    }
    print.step(`Попытка установить через ${attempt.label} ...`);
    let status: number | null;
    try {
      status = await spawnImpl(attempt.bin, attempt.args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      print.warn(`Установка через ${attempt.label} упала с ошибкой: ${message}`);
      continue;
    }
    if (status === null || status !== 0) {
      print.warn(
        `Установка через ${attempt.label} завершилась с кодом ${status ?? "null"}.`,
      );
      continue;
    }
    const after = probe();
    if (after.present) {
      print.success(
        `openspec установлен через ${attempt.label}` +
          (after.version ? ` — ${after.version}` : ""),
      );
      return { ...after, installedNow: true };
    }
    print.warn(
      `Установка через ${attempt.label} отработала без ошибок, но openspec всё ещё не в PATH.`,
    );
  }

  return { present: false, installedNow: false };
}