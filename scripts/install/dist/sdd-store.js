"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSddStore = setupSddStore;
exports.resolveSchemaSourcePath = resolveSchemaSourcePath;
exports.printSddStoreIntro = printSddStoreIntro;
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const shell_1 = require("./shell");
const print_1 = require("./print");
const constants_1 = require("./constants");
async function defaultSpawn(bin, args, options) {
    const result = (0, shell_1.runCommand)(bin, args, options);
    return result;
}
async function setupSddStore(options, deps = {}) {
    const spawn = deps.spawn ?? defaultSpawn;
    const hasBinary = deps.hasBinary ?? shell_1.commandExists;
    const schemaName = options.schemaName ?? constants_1.SDD_SCHEMA_NAME;
    const copySchema = options.copySchema ?? defaultCopySchema;
    const result = {
        ok: false,
        storePath: options.storePath,
        storeName: options.storeName,
        initialized: false,
        storeRegistered: false,
        schemaInstalled: false,
        configUpdated: false,
        committedToMaster: false,
    };
    if (!(0, node_fs_1.existsSync)(options.storePath)) {
        print_1.print.error(`Директория ${options.storePath} не найдена.`);
        print_1.print.note(`Создайте её: mkdir -p ${options.storePath}`);
        print_1.print.note("Или передайте --store-path=<существующий путь>.");
        return result;
    }
    if (!hasBinary("openspec")) {
        print_1.print.error("openspec не найден в PATH — прерываю настройку sdd-store.");
        print_1.print.note("Сначала выполните проверку окружения; openspec должен быть установлен.");
        return result;
    }
    print_1.print.step(`openspec init в ${options.storePath} ...`);
    const initResult = await spawn("openspec", ["init", ".", "--tools=none"], {
        cwd: options.storePath,
        stdio: "inherit",
    });
    result.initialized = initResult.status === 0;
    if (!result.initialized) {
        print_1.print.error("openspec init не удался.");
        return result;
    }
    print_1.print.step(`openspec store setup ${options.storeName} --path ${options.storePath} ...`);
    const setupResult = await spawn("openspec", ["store", "setup", options.storeName, "--path", options.storePath], { cwd: options.storePath, stdio: "inherit" });
    result.storeRegistered = setupResult.status === 0;
    if (!result.storeRegistered) {
        print_1.print.error(`openspec store setup ${options.storeName} не удался.`);
        return result;
    }
    print_1.print.step(`Копирование схемы ${schemaName} в openspec/schemas/ ...`);
    result.schemaInstalled = await installLocalSchema({
        storePath: options.storePath,
        schemaName,
        schemaSourcePath: options.schemaSourcePath ?? resolveSchemaSourcePath(),
        copySchema,
    });
    print_1.print.step(`Правка openspec/config.yaml (schema → ${schemaName}) ...`);
    result.configUpdated = updateConfigYaml({
        storePath: options.storePath,
        schemaName,
    });
    print_1.print.step("Коммит изменений в master ...");
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
async function installLocalSchema(deps) {
    const { storePath, schemaName, schemaSourcePath, copySchema } = deps;
    const target = node_path_1.default.join(storePath, "openspec", "schemas", schemaName);
    if (!schemaSourcePath) {
        print_1.print.error("Не удалось найти исходную директорию схемы (scripts/schemas/spec-driven-with-adr).");
        print_1.print.note("Задайте SCHEMA_SOURCE_PATH=/абсолютный/путь/к/схеме или скопируйте файлы вручную в " +
            target);
        return false;
    }
    if (!(0, node_fs_1.existsSync)(schemaSourcePath)) {
        print_1.print.error(`Локальная директория схемы не найдена: ${schemaSourcePath}`);
        print_1.print.note("Проверьте, что scripts/schemas/<" + schemaName + "> существует, " +
            "или задайте SCHEMA_SOURCE_PATH.");
        return false;
    }
    (0, node_fs_1.mkdirSync)(target, { recursive: true });
    try {
        await copySchema(schemaSourcePath, target);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        print_1.print.error(`Не удалось скопировать схему в ${target}: ${message}`);
        return false;
    }
    print_1.print.success(`Схема скопирована: ${schemaSourcePath} → ${target}`);
    return true;
}
async function defaultCopySchema(src, dst) {
    await (0, promises_1.cp)(src, dst, {
        recursive: true,
        filter: (entry) => !node_path_1.default.basename(entry).startsWith(".DS_Store"),
    });
}
function resolveSchemaSourcePath() {
    if (process.env.SCHEMA_SOURCE_PATH) {
        const explicit = node_path_1.default.resolve(process.env.SCHEMA_SOURCE_PATH);
        if ((0, node_fs_1.existsSync)(explicit))
            return explicit;
        return explicit;
    }
    // The compiled installer lives at scripts/install/dist/cli.js.
    // Walk up to the repo root and into scripts/schemas/<schemaName>.
    const candidates = [
        node_path_1.default.resolve(process.cwd(), constants_1.SCHEMA_SOURCE_PATH),
        node_path_1.default.resolve(__dirname, "..", "..", "..", constants_1.SCHEMA_SOURCE_PATH),
        node_path_1.default.resolve(__dirname, "..", "..", constants_1.SCHEMA_SOURCE_PATH),
    ];
    for (const candidate of candidates) {
        if ((0, node_fs_1.existsSync)(candidate))
            return candidate;
    }
    return candidates[0] ?? null;
}
function updateConfigYaml(deps) {
    const { storePath, schemaName } = deps;
    const configPath = node_path_1.default.join(storePath, "openspec", "config.yaml");
    if (!(0, node_fs_1.existsSync)(configPath)) {
        print_1.print.error(`config.yaml не найден: ${configPath}`);
        return false;
    }
    const raw = (0, node_fs_1.readFileSync)(configPath, "utf8");
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
    (0, node_fs_1.writeFileSync)(configPath, lines.join("\n"), { encoding: "utf8" });
    print_1.print.success(`config.yaml: schema → ${schemaName}`);
    return true;
}
async function commitToMaster(deps) {
    const { storePath, spawn } = deps;
    await spawn("git", ["add", "."], { cwd: storePath, stdio: "inherit" });
    const commit = await spawn("git", ["commit", "-m", "chore: install spec-drive-with-adr schema"], { cwd: storePath, stdio: "inherit" });
    if (commit.status !== 0) {
        print_1.print.warn("git commit не удался — возможно, нет изменений для коммита.");
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
    print_1.print.success("Изменения закоммичены в master.");
    return true;
}
function printSddStoreIntro() {
    print_1.print.section("◰", "sdd-store");
    print_1.print.info("Нужен отдельный репозиторий, который будет хранить спецификации OpenSpec.");
    print_1.print.note("Создайте пустую папку и сообщите инсталлятору её путь и название store.");
    print_1.print.note("В эту папку будет установлена схема spec-drive-with-adr и сделан коммит в master.");
    print_1.print.blank();
}
