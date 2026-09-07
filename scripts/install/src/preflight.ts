import { commandExists, runCommand } from "./shell";
import {
  INSTALLER_INSTRUCTION_GIGACODE,
  INSTALLER_INSTRUCTION_UV,
} from "./constants";
import { print } from "./print";

export type ToolId = "node" | "uv" | "gigacode";

export interface PreflightStatus {
  present: boolean;
  version?: string;
  binary?: string;
}

export interface PreflightInput {
  node: PreflightStatus;
  uv: PreflightStatus;
  gigacode: PreflightStatus;
}

export interface PreflightCheck {
  id: ToolId;
  label: string;
  required: boolean;
  present: boolean;
  version?: string;
  binary?: string;
  instructions?: string;
  consequence?: string;
}

export interface PreflightResult {
  ok: boolean;
  requiredMissing: ToolId[];
  optionalMissing: ToolId[];
  checks: PreflightCheck[];
}

function probe(bin: string, args: string[] = ["--version"]): PreflightStatus {
  if (!commandExists(bin)) {
    return { present: false };
  }
  const result = runCommand(bin, args, { stdio: "pipe" });
  if (result.status !== 0) {
    return { present: true, binary: bin };
  }
  const stream = (result.stdout || result.stderr || "").trim();
  const firstLine = stream.split("\n", 1)[0]?.trim() ?? "";
  return {
    present: true,
    version: firstLine || undefined,
    binary: bin,
  };
}

export async function probeEnvironment(): Promise<PreflightInput> {
  return {
    node: probe("node"),
    uv: probe("uv"),
    gigacode: probe("gigacode"),
  };
}

export function evaluatePreflight(input: PreflightInput): PreflightResult {
  const checks: PreflightCheck[] = [
    {
      id: "node",
      label: "node",
      required: true,
      present: input.node.present,
      version: input.node.version,
      binary: input.node.binary,
      consequence: "Требуется для запуска самого инсталлятора и записи settings.json.",
    },
    {
      id: "uv",
      label: "uv",
      required: true,
      present: input.uv.present,
      version: input.uv.version,
      binary: input.uv.binary,
      consequence:
        "Нужен для установки MCP-сервера code-review-graph через uv pip install. uv использует собственный Python, системный python не требуется.",
      instructions: INSTALLER_INSTRUCTION_UV,
    },
    {
      id: "gigacode",
      label: "gigacode",
      required: true,
      present: input.gigacode.present,
      version: input.gigacode.version,
      binary: input.gigacode.binary,
      consequence:
        "Используется самой доской на каждом шаге (gigacode --prompt). Без него прогон change-proposal невозможен.",
      instructions: INSTALLER_INSTRUCTION_GIGACODE,
    },
  ];

  const requiredMissing = checks
    .filter((c) => c.required && !c.present)
    .map((c) => c.id);
  const optionalMissing = checks
    .filter((c) => !c.required && !c.present)
    .map((c) => c.id);

  return {
    ok: requiredMissing.length === 0,
    requiredMissing,
    optionalMissing,
    checks,
  };
}

function formatCheck(check: PreflightCheck): string {
  const showBinary =
    typeof check.binary === "string" &&
    check.binary.length > 0 &&
    check.binary !== check.label;
  const binarySuffix = showBinary ? ` (${check.binary})` : "";
  const versionSuffix = check.version ? ` — ${check.version}` : "";
  return `${check.label}${binarySuffix}${versionSuffix}`;
}

export async function runPreflight(): Promise<PreflightResult> {
  const input = await probeEnvironment();
  const result = evaluatePreflight(input);

  print.section("Проверка окружения");
  for (const check of result.checks) {
    if (check.present) {
      print.success(formatCheck(check));
      continue;
    }
    if (check.required) {
      print.error(`${check.label} — не найден (обязательно)`);
    } else {
      print.warn(`${check.label} — не найден`);
    }
    if (check.consequence) print.note(check.consequence);
    if (check.instructions) print.note(check.instructions);
  }
  print.blank();

  if (result.ok) {
    if (result.optionalMissing.length === 0) {
      print.info("Все инструменты найдены.");
    } else {
      print.info(
        `Найдены все обязательные инструменты. Опциональные отсутствуют: ${result.optionalMissing.join(", ")}.`,
      );
    }
  } else {
    print.error(
      `Не найдены обязательные инструменты: ${result.requiredMissing.join(", ")}.`,
    );
    print.warn(
      "Установите их и запустите инсталлятор повторно. Выход без изменений.",
    );
  }
  print.blank();

  return result;
}