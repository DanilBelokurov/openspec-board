#!/usr/bin/env bash

set -euo pipefail

INSTALL_MODE=""

show_installation_info() {
  printf '%s\n\n' "Будет установлено всё необходимое harness-окружение для работы доски sdd:"
  printf '%s\n' "  • MCP-сервер jira"
  printf '%s\n' "  • MCP-сервер sbertrack"
  printf '%s\n' "  • MCP-сервер bitbucket"
  printf '%s\n\n' "  • MCP-сервер sourcecontrol"
}

install_jira_mcp() {
  local settings_dir="$HOME/.gigacode"
  local settings_file="$settings_dir/settings.json"
  local jira_token

  printf '%s' "Введите токен Jira: "
  IFS= read -r -s jira_token
  printf '\n'

  if [[ -z "$jira_token" ]]; then
    printf '%s\n' "Токен Jira не может быть пустым." >&2
    return 1
  fi

  if ! command -v node >/dev/null 2>&1; then
    printf '%s\n' "Для обновления .gigacode/settings.json требуется Node.js." >&2
    return 1
  fi

  mkdir -p "$settings_dir"
  SDD_JIRA_TOKEN="$jira_token" SETTINGS_FILE="$settings_file" node <<'NODE'
const fs = require("fs");

const settingsFile = process.env.SETTINGS_FILE;
const token = process.env.SDD_JIRA_TOKEN;

function readSettings() {
  if (fs.existsSync(settingsFile)) {
    const raw = fs.readFileSync(settingsFile, "utf8").trim();
    if (raw.length > 0) return JSON.parse(raw);
  }
  return {};
}

function ensureObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

const settings = readSettings();
ensureObject(settings, "Файл .gigacode/settings.json должен содержать JSON-объект.");

if (settings.mcpServers === undefined) {
  settings.mcpServers = {};
}
ensureObject(
  settings.mcpServers,
  "Поле mcpServers в settings.json должно быть JSON-объектом.",
);

settings.mcpServers["jira-mcp"] = {
  type: "streamable-http",
  httpUrl: "https://api.sbertrack.sberbank.zu/jira/mcp",
  headers: {
    "x-jira-token": token,
  },
};

const temporaryFile = `${settingsFile}.tmp-${process.pid}`;
fs.writeFileSync(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
fs.chmodSync(temporaryFile, 0o600);
fs.renameSync(temporaryFile, settingsFile);
NODE

  unset jira_token
  printf '%s\n' "MCP-сервер jira-mcp добавлен в $settings_file."

  SETTINGS_FILE="$settings_file" PERMISSION_TOOL="mcp__jira-mcp__add_labels" node <<'NODE'
const fs = require("fs");

const settingsFile = process.env.SETTINGS_FILE;
const permissionTool = process.env.PERMISSION_TOOL;
const result = { permissionAdded: false };

let settings = {};
if (fs.existsSync(settingsFile)) {
  const raw = fs.readFileSync(settingsFile, "utf8").trim();
  if (raw.length > 0) settings = JSON.parse(raw);
}

if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
  throw new Error("Файл .gigacode/settings.json должен содержать JSON-объект.");
}

if (settings.permissions === undefined) {
  settings.permissions = {};
}
if (
  !settings.permissions ||
  typeof settings.permissions !== "object" ||
  Array.isArray(settings.permissions)
) {
  throw new Error("Поле permissions в settings.json должно быть JSON-объектом.");
}

if (!Array.isArray(settings.permissions.allow)) {
  settings.permissions.allow = [];
}
if (
  !settings.permissions.allow.every((value) => typeof value === "string")
) {
  throw new Error("Поле permissions.allow должно содержать только строки.");
}

if (!settings.permissions.allow.includes(permissionTool)) {
  settings.permissions.allow.push(permissionTool);
  result.permissionAdded = true;
}

const temporaryFile = `${settingsFile}.tmp-${process.pid}`;
fs.writeFileSync(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
fs.chmodSync(temporaryFile, 0o600);
fs.renameSync(temporaryFile, settingsFile);

process.stdout.write(JSON.stringify(result));
NODE

  printf '%s\n' "Разрешение mcp__jira-mcp__add_labels добавлено в permissions.allow."
}

select_install_mode() {
  local -a labels=("Аналитик/разработчик" "Эксперт УЭК")
  local -a values=("analyst-developer" "uek-expert")
  local selected=0
  local key rest

  printf '%s\n\n' "В каком режиме установить доску sdd?"
  printf '\033[?25l'

  render_options() {
    local index
    for index in "${!labels[@]}"; do
      if [[ "$index" -eq "$selected" ]]; then
        printf '\033[1m❯ %s\033[0m\n' "${labels[$index]}"
      else
        printf '  %s\n' "${labels[$index]}"
      fi
    done
  }

  render_options
  while true; do
    IFS= read -rsn1 key
    if [[ "$key" == $'\x1b' ]]; then
      IFS= read -rsn2 -t 1 rest || true
      case "$rest" in
        '[A') selected=$(( (selected + ${#labels[@]} - 1) % ${#labels[@]} )) ;;
        '[B') selected=$(( (selected + 1) % ${#labels[@]} )) ;;
        *) continue ;;
      esac
      printf '\033[2A'
      render_options
    elif [[ "$key" == "" ]]; then
      INSTALL_MODE="${values[$selected]}"
      printf '\033[?25h\n'
      printf 'Выбран режим установки: %s\n' "${labels[$selected]}"
      break
    fi
  done
}

install_board() {
  local mode="$1"

  printf '%s\n' "Общие шаги установки будут выполнены в этом потоке."
  printf '%s\n' "Дополнительные зависимости для режима пока не настроены."
}

main() {
  show_installation_info
  install_jira_mcp
  select_install_mode
  install_board "$INSTALL_MODE"
}

main "$@"
