import { commandExists, runCommand } from "./shell";
import {
  INSTALLER_INSTRUCTION_PIP,
  INSTALLER_INSTRUCTION_UV,
} from "./constants";
import { print } from "./print";

export type ToolId = "node" | "python" | "uv" | "gigacode";

export interface PreflightStatus {
  present: boolean;
  version?: string;
}

export interface PreflightInput {
  node: PreflightStatus;
  python: PreflightStatus;
  uv: PreflightStatus;
  gigacode: PreflightStatus;
}

export interface PreflightCheck {
  id: ToolId;
  label: string;
  required: boolean;
  present: boolean;
  version?: string;
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
    return { present: true };
  }
  const stream = (result.stdout || result.stderr || "").trim();
  const firstLine = stream.split("\n", 1)[0]?.trim() ?? "";
  return { present: true, version: firstLine || undefined };
}

export async function probeEnvironment(): Promise<PreflightInput> {
  return {
    node: probe("node"),
    python: probe("python"),
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
      consequence: "Требуется для запуска самого инсталлятора и записи settings.json.",
    },
    {
      id: "python",
      label: "python",
      required: false,
      present: input.python.present,
      version: input.python.version,
      consequence: "Нужен для MCP-сервера code-review-graph (устанавливается в режиме «Аналитик/разработчик»).",
      instructions: INSTALLER_INSTRUCTION_PIP,
    },
    {
      id: "uv",
      label: "uv",
      required: false,
      present: input.uv.present,
      version: input.uv.version,
      consequence: "Нужен для установки MCP-сервера code-review-graph через uv pip install.",
      instructions: INSTALLER_INSTRUCTION_UV,
    },
    {
      id: "gigacode",
      label: "gigacode",
      required: false,
      present: input.gigacode.present,
      version: input.gigacode.version,
      consequence: "Используется самой доской (gigacode --prompt per-step).",
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

export async function runPreflight(): Promise<PreflightResult> {
  const input = await probeEnvironment();
  const result = evaluatePreflight(input);

  print.section("Проверка окружения");
  for (const check of result.checks) {
    const version = check.version ? ` ${check.version}` : "";
    if (check.present) {
      print.success(`${check.label}${version}`);
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