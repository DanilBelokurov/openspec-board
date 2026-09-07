import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { commandExists, runCommand } from "./shell";
import { print } from "./print";
import { SDD_SCHEMA_NAME, SDD_SCHEMA_REPO_URL } from "./constants";

export interface SddStoreSetupOptions {
  storePath: string;
  storeName: string;
  schemaName?: string;
  schemaRepoUrl?: string;
}

export interface SddStoreSetupResult {
  ok: boolean;
  storePath: string;
  storeName: string;
  initialized: boolean;
  storeRegistered: boolean;
  schemaInstalled: boolean;
  configUpdated: boolean;
  committedToMaster: boolean;
}

export type SpawnFn = (
  bin: string,
  args: string[],
  options: { cwd: string; stdio: "inherit" | "pipe" },
) => Promise<{ status: number | null; stdout: string; stderr: string }>;

async function defaultSpawn(
  bin: string,
  args: string[],
  options: { cwd: string; stdio: "inherit" | "pipe" },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const result = runCommand(bin, args, options);
  return result;
}

export interface SetupSddStoreDeps {
  spawn?: SpawnFn;
  hasBinary?: (bin: string) => boolean;
}

export async function setupSddStore(
  options: SddStoreSetupOptions,
  deps: SetupSddStoreDeps = {},
): Promise<SddStoreSetupResult> {
  const spawn = deps.spawn ?? defaultSpawn;
  const hasBinary = deps.hasBinary ?? commandExists;
  const schemaName = options.schemaName ?? SDD_SCHEMA_NAME;
  const schemaRepoUrl = options.schemaRepoUrl ?? SDD_SCHEMA_REPO_URL;

  const result: SddStoreSetupResult = {
    ok: false,
    storePath: options.storePath,
    storeName: options.storeName,
    initialized: false,
    storeRegistered: false,
    schemaInstalled: false,
    configUpdated: false,
    committedToMaster: false,
  };

  if (!existsSync(options.storePath)) {
    print.error(`Директория ${options.storePath} не найдена.`);
    print.note(`Создайте её: mkdir -p ${options.storePath}`);
    print.note("Или передайте --store-path=<существующий путь>.");
    return result;
  }

  if (!hasBinary("openspec")) {
    print.error("openspec не найден в PATH — прерываю настройку sdd-store.");
    print.note("Сначала выполните проверку окружения; openspec должен быть установлен.");
    return result;
  }

  print.step(`openspec init в ${options.storePath} ...`);
  const initResult = await spawn("openspec", ["init", ".", "--tools=none"], {
    cwd: options.storePath,
    stdio: "inherit",
  });
  result.initialized = initResult.status === 0;
  if (!result.initialized) {
    print.error("openspec init не удался.");
    return result;
  }

  print.step(`openspec store setup ${options.storeName} --path ${options.storePath} ...`);
  const setupResult = await spawn(
    "openspec",
    ["store", "setup", options.storeName, "--path", options.storePath],
    { cwd: options.storePath, stdio: "inherit" },
  );
  result.storeRegistered = setupResult.status === 0;
  if (!result.storeRegistered) {
    print.error(`openspec store setup ${options.storeName} не удался.`);
    return result;
  }

  print.step(`Установка схемы ${schemaName} из ${schemaRepoUrl} ...`);
  result.schemaInstalled = await installSchema({
    storePath: options.storePath,
    schemaName,
    schemaRepoUrl,
    spawn,
  });

  print.step(`Правка openspec/config.yaml (schema → ${schemaName}) ...`);
  result.configUpdated = updateConfigYaml({
    storePath: options.storePath,
    schemaName,
  });

  print.step("Коммит изменений в master ...");
  result.committedToMaster = await commitToMaster({
    storePath: options.storePath,
    spawn,
  });

  result.ok =
    result.initialized &&
    result.storeRegistered &&
    result.schemaInstalled &&
    result.configUpdated &&
    result.committedToMaster;
  return result;
}

interface InstallSchemaDeps {
  storePath: string;
  schemaName: string;
  schemaRepoUrl: string;
  spawn: SpawnFn;
}

async function installSchema(deps: InstallSchemaDeps): Promise<boolean> {
  const { storePath, schemaName, schemaRepoUrl, spawn } = deps;
  const target = path.join(storePath, "openspec", "schemas", schemaName);

  if (
    schemaRepoUrl.includes("example.com") ||
    !/^https?:\/\//.test(schemaRepoUrl)
  ) {
    print.warn(
      `SDD_SCHEMA_REPO_URL — placeholder (${schemaRepoUrl}). ` +
        "Схема будет скопирована при следующем запуске инсталлятора с реальной ссылкой.",
    );
    return false;
  }

  mkdirSync(target, { recursive: true });

  // Stage the clone into a temp dir and copy contents into target.
  // Using spawn(...) for cp -R keeps the shell-out explicit.
  const tmp = path.join(storePath, ".sdd-schema-stage");
  const cloneResult = await spawn("git", ["clone", "--depth", "1", schemaRepoUrl, tmp], {
    cwd: storePath,
    stdio: "inherit",
  });
  if (cloneResult.status !== 0) {
    print.error(`Не удалось склонировать ${schemaRepoUrl}.`);
    return false;
  }
  const copyResult = await spawn("cp", ["-R", `${tmp}/.`, target], {
    cwd: storePath,
    stdio: "inherit",
  });
  await spawn("rm", ["-rf", tmp], { cwd: storePath, stdio: "pipe" });
  if (copyResult.status !== 0) {
    print.error(`Не удалось скопировать схему в ${target}.`);
    return false;
  }
  print.success(`Схема установлена: ${target}`);
  return true;
}

interface UpdateConfigDeps {
  storePath: string;
  schemaName: string;
}

function updateConfigYaml(deps: UpdateConfigDeps): boolean {
  const { storePath, schemaName } = deps;
  const configPath = path.join(storePath, "openspec", "config.yaml");
  if (!existsSync(configPath)) {
    print.error(`config.yaml не найден: ${configPath}`);
    return false;
  }
  const raw = readFileSync(configPath, "utf8");
  const lines = raw.split("\n");
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^schema:\s*/.test(lines[i])) {
      lines[i] = `schema: ${schemaName}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    lines.push(`schema: ${schemaName}`);
  }
  writeFileSync(configPath, lines.join("\n"), { encoding: "utf8" });
  print.success(`config.yaml: schema → ${schemaName}`);
  return true;
}

interface CommitDeps {
  storePath: string;
  spawn: SpawnFn;
}

async function commitToMaster(deps: CommitDeps): Promise<boolean> {
  const { storePath, spawn } = deps;
  await spawn("git", ["add", "."], { cwd: storePath, stdio: "inherit" });
  const commit = await spawn(
    "git",
    ["commit", "-m", "chore: install spec-drive-with-adr schema"],
    { cwd: storePath, stdio: "inherit" },
  );
  if (commit.status !== 0) {
    print.warn("git commit не удался — возможно, нет изменений для коммита.");
    return false;
  }
  const branchInfo = await spawn("git", ["branch", "--show-current"], {
    cwd: storePath,
    stdio: "pipe",
  });
  const current = (branchInfo.stdout ?? "").trim();
  if (current && current !== "master") {
    await spawn("git", ["branch", "-M", "master"], {
      cwd: storePath,
      stdio: "inherit",
    });
  }
  print.success("Изменения закоммичены в master.");
  return true;
}

export function printSddStoreIntro(): void {
  print.section("◰", "sdd-store");
  print.info(
    "Нужен отдельный репозиторий, который будет хранить спецификации OpenSpec.",
  );
  print.note("Создайте пустую папку и сообщите инсталлятору её путь и название store.");
  print.note("В эту папку будет установлена схема spec-drive-with-adr и сделан коммит в master.");
  print.blank();
}