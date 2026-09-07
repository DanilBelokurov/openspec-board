import { findCatalogEntryByRaw } from "../catalog";
import { installJiraMcp } from "./jira";
import { installBitbucketMcp } from "./bitbucket";
import { installSourcecontrolMcp } from "./sourcecontrol";
import { installSbertrackMcp } from "./sbertrack";
import { print } from "../print";

export interface InstallerContext {
  settingsFilePath: string;
}

export type InstallerResult = "installed" | "skipped" | "failed";

export async function dispatchMcpInstall(
  rawValue: string,
  context: InstallerContext,
  tokenOverride?: string,
): Promise<InstallerResult> {
  const entry = findCatalogEntryByRaw(rawValue);
  if (!entry) {
    print.error(`Неизвестный сервер: ${rawValue}`);
    return "failed";
  }

  print.step(`Устанавливаю ${entry.displayLabel} ...`);
  let ok = false;
  switch (rawValue) {
    case "jira":
      ok = await installJiraMcp({
        settingsFilePath: context.settingsFilePath,
        token: tokenOverride,
      });
      break;
    case "bitbucket":
      ok = await installBitbucketMcp({
        settingsFilePath: context.settingsFilePath,
        token: tokenOverride,
      });
      break;
    case "sourcecontrol":
      ok = await installSourcecontrolMcp({
        settingsFilePath: context.settingsFilePath,
        token: tokenOverride,
      });
      break;
    case "sbertrack":
      ok = installSbertrackMcp();
      break;
    default:
      print.error(`Неизвестный сервер: ${rawValue}`);
      return "failed";
  }

  if (!ok) {
    print.warn(`Установка ${rawValue}-mcp не завершена — продолжаю.`);
    return "failed";
  }
  return "installed";
}