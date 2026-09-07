import { spawnSync } from "node:child_process";

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
  input?: string;
}

export interface RunCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export function commandExists(bin: string): boolean {
  const probe = spawnSync("which", [bin], { stdio: "ignore" });
  return probe.status === 0;
}

export function runCommand(
  bin: string,
  args: string[],
  options: RunCommandOptions = {},
): RunCommandResult {
  const stdio = options.stdio ?? "inherit";
  const proc = spawnSync(bin, args, {
    cwd: options.cwd,
    env: options.env,
    stdio,
    input: options.input,
    encoding: "utf8",
  });

  return {
    status: proc.status,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    error: proc.error ?? undefined,
  };
}