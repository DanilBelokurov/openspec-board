import { cp } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { commandExists, runCommand } from "./shell";
import { print } from "./print";
import { SCHEMA_SOURCE_PATH, SDD_SCHEMA_NAME } from "./constants";

export interface SddStoreSetupOptions {
  storePath: string;
  storeName: string;
  schemaName?: string;
  schemaSourcePath?: string;
  copySchema?: (src: string, dst: string) => Promise<void>;
}

export interface SddStoreSetupResult {
  ok: boolean;
  storePath: string;
  storeName: string;
  initialized: boolean;
  storeRegistered: boolean;
  defaultStoreSet: boolean;
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
  const copySchema = options.copySchema ?? defaultCopySchema;

  const result: SddStoreSetupResult = {
    ok: false,
    storePath: options.storePath,
    storeName: options.storeName,
    initialized: false,
    storeRegistered: false,
    defaultStoreSet: false,
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

  // Pin the just-registered store as the machine-level fallback so
  // `openspec new change` can resolve a store from inside a worktree
  // (which has no local openspec/ root and no project config.yaml to
  // point at a store). Resolution precedence (per openspec docs/cli.md):
  //   1. --store flag on the command
  //   2. local openspec root in cwd
  //   3. store: in openspec/config.yaml
  //   4. defaultStore from global config  ← this step
  // Without defaultStore, step 4 is empty and any worktree-scoped
  // `openspec new change` (which the board uses for proposal creation)
  // would fail with "no store resolved".
  print.step(
    `openspec config set defaultStore ${options.storeName} ...`,
  );
  const defaultStoreResult = await spawn(
    "openspec",
    ["config", "set", "defaultStore", options.storeName],
    { cwd: options.storePath, stdio: "inherit" },
  );
  result.defaultStoreSet = defaultStoreResult.status === 0;
  if (!result.defaultStoreSet) {
    print.error(
      `openspec config set defaultStore ${options.storeName} не удался.`,
    );
    print.note(
      "Стор зарегистрирован, но глобальный фолбэк не выставлен. " +
        "Запустите вручную: openspec config set defaultStore " +
        options.storeName,
    );
    return result;
  }
  print.success(`defaultStore → ${options.storeName}`);

  print.step(`Копирование схемы ${schemaName} в openspec/schemas/ ...`);
  result.schemaInstalled = await installLocalSchema({
    storePath: options.storePath,
    schemaName,
    schemaSourcePath:
      options.schemaSourcePath ?? resolveSchemaSourcePath(),
    copySchema,
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
    result.defaultStoreSet &&
    result.schemaInstalled &&
    result.configUpdated &&
    result.committedToMaster;
  return result;
}

interface InstallLocalSchemaDeps {
  storePath: string;
  schemaName: string;
  schemaSourcePath: string | null;
  copySchema: (src: string, dst: string) => Promise<void>;
}

async function installLocalSchema(deps: InstallLocalSchemaDeps): Promise<boolean> {
  const { storePath, schemaName, schemaSourcePath, copySchema } = deps;
  const target = path.join(storePath, "openspec", "schemas", schemaName);

  if (!schemaSourcePath) {
    print.error(
      "Не удалось найти исходную директорию схемы (scripts/schemas/spec-driven-with-adr).",
    );
    print.note(
      "Задайте SCHEMA_SOURCE_PATH=/абсолютный/путь/к/схеме или скопируйте файлы вручную в " +
        target,
    );
    return false;
  }

  if (!existsSync(schemaSourcePath)) {
    print.error(`Локальная директория схемы не найдена: ${schemaSourcePath}`);
    print.note(
      "Проверьте, что scripts/schemas/<" + schemaName + "> существует, " +
        "или задайте SCHEMA_SOURCE_PATH.",
    );
    return false;
  }

  mkdirSync(target, { recursive: true });
  try {
    await copySchema(schemaSourcePath, target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    print.error(`Не удалось скопировать схему в ${target}: ${message}`);
    return false;
  }
  print.success(`Схема скопирована: ${schemaSourcePath} → ${target}`);
  return true;
}

async function defaultCopySchema(src: string, dst: string): Promise<void> {
  await cp(src, dst, {
    recursive: true,
    filter: (entry) => !path.basename(entry).startsWith(".DS_Store"),
  });
}

export function resolveSchemaSourcePath(): string | null {
  if (process.env.SCHEMA_SOURCE_PATH) {
    const explicit = path.resolve(process.env.SCHEMA_SOURCE_PATH);
    if (existsSync(explicit)) return explicit;
    return explicit;
  }
  // The compiled installer lives at scripts/install/dist/cli.js.
  // Walk up to the repo root and into scripts/schemas/<schemaName>.
  const candidates = [
    path.resolve(process.cwd(), SCHEMA_SOURCE_PATH),
    path.resolve(__dirname, "..", "..", "..", SCHEMA_SOURCE_PATH),
    path.resolve(__dirname, "..", "..", SCHEMA_SOURCE_PATH),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? null;
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