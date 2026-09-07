import { MCP_CATALOG_ENTRIES } from "./catalog";
import { detectInstalledMcpServers, isMcpInstalled } from "./detect";
import { reconcileMcpServerKeys, syncRequiredPermissions } from "./permissions";
import { selectCheckboxes, type CheckboxOption } from "./prompts";
import { selectInstallMode } from "./mode";
import { installBoard } from "./installers/board";
import { installCodeReviewGraphMcp } from "./installers/code-review-graph";
import { dispatchMcpInstall } from "./installers/index";
import { getSettingsPath } from "./settings";
import type { InstallMode } from "./constants";

export function showInstallationInfo(): void {
  console.log("Будет установлено всё необходимое harness-окружение для работы доски sdd.");
  console.log("");
}

export interface InstallCommandOptions {
  projectRoot: string;
  settingsFilePath?: string;
  force: boolean;
  nonInteractive: boolean;
  modeOverride?: InstallMode;
  toolsOverride?: string[];
  tokenOverrides?: Record<string, string>;
}

export class InstallCommand {
  constructor(private readonly options: InstallCommandOptions) {}

  async run(): Promise<void> {
    showInstallationInfo();
    await this.installSelectedMcps();
    const mode = await selectInstallMode(
      this.options.nonInteractive,
      this.options.modeOverride,
    );
    if (mode === "analyst-developer") {
      await installCodeReviewGraphMcp({
        settingsFilePath: this.settingsFilePath,
        force: this.options.force,
      });
    }
    await installBoard({
      projectRoot: this.options.projectRoot,
      mode,
      force: this.options.force,
    });
  }

  get settingsFilePath(): string {
    return this.options.settingsFilePath ?? getSettingsPath();
  }

  private async installSelectedMcps(): Promise<void> {
    await reconcileMcpServerKeys(this.settingsFilePath);

    const detectedKeys = detectInstalledMcpServers(this.settingsFilePath);

    const lockedRawValues: string[] = [];
    const checkboxOptions: CheckboxOption[] = MCP_CATALOG_ENTRIES.map((entry) => {
      const isInstalled = isMcpInstalled(detectedKeys, entry.settingsKey);
      if (isInstalled) lockedRawValues.push(entry.rawValue);
      return {
        label: isInstalled ? `${entry.displayLabel} (уже установлен)` : entry.displayLabel,
        value: entry.rawValue,
        locked: isInstalled,
      };
    });

    if (lockedRawValues.length > 0 && !this.options.force) {
      console.error("Уже установленные (●) будут пропущены.");
      console.error(
        " Для принудительной переустановки задайте INSTALLER_FORCE_REINSTALL_LOCKED=1.",
      );
    }
    if (this.options.force) {
      console.error(
        `INSTALLER_FORCE_REINSTALL_LOCKED=1 — принудительная переустановка включена.`,
      );
    }

    let chosen: string[];
    if (this.options.toolsOverride && this.options.toolsOverride.length > 0) {
      chosen = this.options.toolsOverride;
    } else if (this.options.nonInteractive) {
      chosen = lockedRawValues.length > 0 ? lockedRawValues : [];
    } else {
      chosen = await selectCheckboxes(
        "Какие MCP-серверы установить?",
        checkboxOptions,
      );
    }

    const effective = this.options.force
      ? chosen
      : chosen.filter((name) => !lockedRawValues.includes(name));
    const skippedLocked = chosen.filter((name) => lockedRawValues.includes(name));

    if (skippedLocked.length > 0) {
      console.log(`Пропущено (уже установлено): ${skippedLocked.join(" ")}`);
    }

    if (effective.length === 0) {
      if (chosen.length > 0) {
        console.log("Все выбранные серверы уже установлены — переустановка не требуется.");
      } else {
        console.log("Ни один MCP-сервер не выбран.");
      }
      await syncRequiredPermissions(this.settingsFilePath);
      return;
    }

    for (const name of effective) {
      const token = this.options.tokenOverrides?.[name];
      await dispatchMcpInstall(name, { settingsFilePath: this.settingsFilePath }, token);
    }

    await syncRequiredPermissions(this.settingsFilePath);
  }
}