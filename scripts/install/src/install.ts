import path from "node:path";
import { MCP_CATALOG_ENTRIES } from "./catalog";
import { detectInstalledMcpServers, isMcpInstalled } from "./detect";
import { reconcileMcpServerKeys, syncRequiredPermissions } from "./permissions";
import { promptForText, selectCheckboxes, type CheckboxOption } from "./prompts";
import { selectInstallMode } from "./mode";
import { installBoard } from "./installers/board";
import { installCodeReviewGraphMcp } from "./installers/code-review-graph";
import { dispatchMcpInstall } from "./installers/index";
import { getSettingsPath } from "./settings";
import { runPreflight } from "./preflight";
import { print } from "./print";
import type { InstallMode } from "./constants";
import { installSddLauncher } from "./binaries/sdd-launcher";
import { printSddStoreIntro, setupSddStore } from "./sdd-store";

export interface InstallCommandOptions {
  projectRoot: string;
  settingsFilePath?: string;
  force: boolean;
  nonInteractive: boolean;
  modeOverride?: InstallMode;
  toolsOverride?: string[];
  tokenOverrides?: Record<string, string>;
  sddStorePath?: string;
  sddStoreName?: string;
}

export class InstallCommand {
  constructor(private readonly options: InstallCommandOptions) {}

  async run(): Promise<void> {
    print.banner(
      "sdd-board install",
      "установка harness-окружения для доски sdd-sessions-board",
    );

    const preflight = await runPreflight();
    if (!preflight.ok) {
      process.exit(1);
    }

    await this.installSelectedMcps();

    const mode = await selectInstallMode(
      this.options.nonInteractive,
      this.options.modeOverride,
    );

    if (mode === "analyst-developer") {
      print.section("⚡", "Code-review-graph MCP");
      await installCodeReviewGraphMcp({
        settingsFilePath: this.settingsFilePath,
        force: this.options.force,
      });

      await this.setupSddStore();
    }

    await installBoard({
      projectRoot: this.options.projectRoot,
      mode,
      force: this.options.force,
    });

    this.installSddCommand();

    process.exit(0);
  }

  private installSddCommand(): void {
    print.section("▶", "Команда sdd");
    const result = installSddLauncher(this.options.projectRoot);
    if (result.onPath) {
      print.success(`sdd → ${result.path}`);
      print.note("Откройте новый терминал и введите 'sdd' для запуска доски.");
    } else {
      const binDir = path.dirname(result.path);
      print.warn(`sdd установлена, но ${binDir} не в PATH.`);
      print.note("Добавьте строку ниже в ваш ~/.zshrc или ~/.bashrc:");
      print.note(`  export PATH="${binDir}:$PATH"`);
      print.note("После этого откройте новый терминал и введите 'sdd'.");
    }
    print.blank();
  }

  private async setupSddStore(): Promise<void> {
    printSddStoreIntro();

    let storePath = this.options.sddStorePath;
    let storeName = this.options.sddStoreName;

    if (!storePath) {
      if (this.options.nonInteractive) {
        print.error(
          "--non-interactive требует --store-path=<путь> и --store-name=<название>",
        );
        process.exit(1);
      }
      storePath = await promptForText(
        "Путь к локальной директории sdd-store",
        "Абсолютный путь к пустой (или свежей) папке, например ~/projects/sdd-store-specs",
        undefined,
      );
    }
    if (!storeName) {
      if (this.options.nonInteractive) {
        print.error(
          "--non-interactive требует --store-path=<путь> и --store-name=<название>",
        );
        process.exit(1);
      }
      storeName = await promptForText(
        "Название sdd-store",
        "Короткое имя для openspec store setup, например sdd-store",
        undefined,
      );
    }

    const result = await setupSddStore({
      storePath,
      storeName,
      schemaSourcePath: process.env.SCHEMA_SOURCE_PATH,
    });

    if (result.ok) {
      print.success(
        `sdd-store готов: ${result.storeName} → ${result.storePath}`,
      );
    } else {
      print.warn("Настройка sdd-store завершилась с ошибками — проверьте журнал выше.");
    }
    print.blank();
  }

  get settingsFilePath(): string {
    return this.options.settingsFilePath ?? getSettingsPath();
  }

  private async installSelectedMcps(): Promise<void> {
    print.section("⬢", "MCP-серверы");

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

    if (this.options.force) {
      print.warn("Принудительная переустановка включена (--force).");
    }

    let chosen: string[];
    if (this.options.toolsOverride && this.options.toolsOverride.length > 0) {
      chosen = this.options.toolsOverride;
      print.info(`Выбраны MCP через --tools: ${chosen.join(", ")}`);
    } else if (this.options.nonInteractive) {
      chosen = lockedRawValues.length > 0 ? lockedRawValues : [];
      if (chosen.length === 0) {
        print.info("--non-interactive и нет установленных MCP — пропускаю выбор.");
      }
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
      print.dim(`Пропущено (уже установлено): ${skippedLocked.join(", ")}`);
    }

    if (effective.length === 0) {
      if (chosen.length > 0) {
        print.info("Все выбранные серверы уже установлены — переустановка не требуется.");
      } else {
        print.info("Ни один MCP-сервер не выбран.");
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