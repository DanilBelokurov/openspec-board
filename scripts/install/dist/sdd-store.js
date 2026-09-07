"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSddStore = setupSddStore;
exports.printSddStoreIntro = printSddStoreIntro;
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
    const schemaRepoUrl = options.schemaRepoUrl ?? constants_1.SDD_SCHEMA_REPO_URL;
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
    print_1.print.step(`Установка схемы ${schemaName} из ${schemaRepoUrl} ...`);
    result.schemaInstalled = await installSchema({
        storePath: options.storePath,
        schemaName,
        schemaRepoUrl,
        spawn,
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
async function installSchema(deps) {
    const { storePath, schemaName, schemaRepoUrl, spawn } = deps;
    const target = node_path_1.default.join(storePath, "openspec", "schemas", schemaName);
    if (schemaRepoUrl.includes("example.com") ||
        !/^https?:\/\//.test(schemaRepoUrl)) {
        print_1.print.warn(`SDD_SCHEMA_REPO_URL — placeholder (${schemaRepoUrl}). ` +
            "Схема будет скопирована при следующем запуске инсталлятора с реальной ссылкой.");
        return false;
    }
    (0, node_fs_1.mkdirSync)(target, { recursive: true });
    // Stage the clone into a temp dir and copy contents into target.
    // Using spawn(...) for cp -R keeps the shell-out explicit.
    const tmp = node_path_1.default.join(storePath, ".sdd-schema-stage");
    const cloneResult = await spawn("git", ["clone", "--depth", "1", schemaRepoUrl, tmp], {
        cwd: storePath,
        stdio: "inherit",
    });
    if (cloneResult.status !== 0) {
        print_1.print.error(`Не удалось склонировать ${schemaRepoUrl}.`);
        return false;
    }
    const copyResult = await spawn("cp", ["-R", `${tmp}/.`, target], {
        cwd: storePath,
        stdio: "inherit",
    });
    await spawn("rm", ["-rf", tmp], { cwd: storePath, stdio: "pipe" });
    if (copyResult.status !== 0) {
        print_1.print.error(`Не удалось скопировать схему в ${target}.`);
        return false;
    }
    print_1.print.success(`Схема установлена: ${target}`);
    return true;
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
