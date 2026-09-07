import { promises as fs } from "node:fs";
import { chmodSync, renameSync, writeFileSync } from "node:fs";

export interface AtomicWriteOptions {
  mode?: number;
  trailingNewline?: boolean;
}

const DEFAULT_MODE = 0o600;

export async function atomicWriteJson(
  filePath: string,
  data: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const { mode = DEFAULT_MODE, trailingNewline = true } = options;
  const payload = JSON.stringify(data, null, 2) + (trailingNewline ? "\n" : "");
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  await fs.writeFile(tempPath, payload, { encoding: "utf8", mode });
  chmodSync(tempPath, mode);
  renameSync(tempPath, filePath);
}