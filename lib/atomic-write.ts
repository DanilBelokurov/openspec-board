import { promises as fs } from "fs";
import path from "path";

/**
 * Atomic file write: write the content to `<path>.tmp.<rand>`
 * first, then `rename` it to `<path>`. On POSIX file systems
 * `rename` within the same directory is atomic — readers see
 * either the old content or the new content, never a
 * half-written file. This protects `state.json` /
 * `config.json` from being truncated to zero bytes if the
 * process is killed mid-write (SIGKILL, power loss, OOM, …)
 * or if two writers race and the second one's `fs.writeFile`
 * interleaves with the first's read-modify-write window.
 *
 * The tmp suffix is randomised by pid + Date.now() + a random
 * tail so two concurrent writers to the same target don't
 * trample each other's tmp file before the rename happens.
 *
 * On Windows, `rename` over an existing file is atomic from
 * the perspective of the source file, but the *target* is
 * unlinked first by Node's `fs.rename`; readers there can
 * still see brief absence. Acceptable for our use: the board
 * either shows the old state or the new one, never a parse
 * error.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 8);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${rand}`;
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}
