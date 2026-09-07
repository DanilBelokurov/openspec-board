import { commandExists, runCommand } from "./shell";

export interface BinaryResolution {
  present: boolean;
  binary?: string;
  version?: string;
}

export function resolveFromCandidates(
  candidates: readonly string[],
  args: string[] = ["--version"],
): BinaryResolution {
  for (const bin of candidates) {
    if (!commandExists(bin)) continue;
    const result = runCommand(bin, args, { stdio: "pipe" });
    if (result.status !== 0) continue;
    const stream = (result.stdout || result.stderr || "").trim();
    const firstLine = stream.split("\n", 1)[0]?.trim() ?? "";
    if (firstLine) {
      return { present: true, binary: bin, version: firstLine };
    }
  }
  return { present: false };
}

export const PYTHON_CANDIDATES: readonly string[] = [
  "python3.13",
  "python3.12",
  "python3.11",
  "python3.10",
  "python3.9",
  "python3.8",
  "python3.7",
  "python3",
  "python",
];

export const PIP_CANDIDATES: readonly string[] = [
  "pip3.13",
  "pip3.12",
  "pip3.11",
  "pip3.10",
  "pip3.9",
  "pip3.8",
  "pip3.7",
  "pip3",
  "pip",
];

export function resolvePython(): BinaryResolution {
  return resolveFromCandidates(PYTHON_CANDIDATES);
}

export function resolvePip(): BinaryResolution {
  return resolveFromCandidates(PIP_CANDIDATES);
}