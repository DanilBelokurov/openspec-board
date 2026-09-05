#!/usr/bin/env bash

set -euo pipefail

INSTALL_MODE=""

# Repositories and endpoints for each MCP server. Adjust here when the
# upstream location changes — every installer reads from these constants
# instead of duplicating URLs.
MCP_SOURCECONTROL_REPO_URL="ssh://sc@api.sc-ci.sber.ru:7998/InSourceHub_AI/ai_market.git"
MCP_SOURCECONTROL_API_URL="https://sc-ci.sber.ru"
MCP_SOURCECONTROL_LOCAL_DIR=".mcp/sourcecontrol"
MCP_SOURCECONTROL_ENTRY="mcp-sourcecontrol/dist/index.js"

show_installation_info() {
  printf '%s\n\n' "Будет установлено всё необходимое harness-окружение для работы доски sdd:"
  printf '%s\n' "  • MCP-сервер jira"
  printf '%s\n' "  • MCP-сервер sbertrack"
  printf '%s\n' "  • MCP-сервер bitbucket"
  printf '%s\n\n' "  • MCP-сервер sourcecontrol"
}

select_arrow_option() {
  local prompt="$1"
  local default_index="$2"
  shift 2
  local -a labels=("$@")
  local -a values=("${labels[@]}")
  local -a display_labels=("${labels[@]}")
  local selected="$default_index"
  local key rest

  printf '%s\n\n' "$prompt" >&2
  printf '\033[?25l' >&2

  render_options() {
    local index
    for index in "${!display_labels[@]}"; do
      if [[ "$index" -eq "$selected" ]]; then
        printf '\033[1m❯ %s\033[0m\n' "${display_labels[$index]}" >&2
      else
        printf '  %s\n' "${display_labels[$index]}" >&2
      fi
    done
  }

  render_options >&2
  while true; do
    if ! IFS= read -rsn1 key; then
      printf '\033[?25h\n' >&2
      SELECTED_OPTION=""
      return 1
    fi
    if [[ "$key" == $'\x1b' ]]; then
      IFS= read -rsn2 -t 1 rest || true
      case "$rest" in
        '[A') selected=$(( (selected + ${#labels[@]} - 1) % ${#labels[@]} )) ;;
        '[B') selected=$(( (selected + 1) % ${#labels[@]} )) ;;
        *) continue ;;
      esac
      printf '\033[2A' >&2
      render_options >&2
    elif [[ -z "$key" || "$key" == $'\n' || "$key" == $'\r' ]]; then
      printf '\033[?25h\n' >&2
      SELECTED_OPTION="${values[$selected]}"
      return 0
    fi
  done
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
}

const temporaryFile = `${settingsFile}.tmp-${process.pid}`;
fs.writeFileSync(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
fs.chmodSync(temporaryFile, 0o600);
fs.renameSync(temporaryFile, settingsFile);
NODE

  printf '%s\n' "Разрешение mcp__jira-mcp__add_labels добавлено в permissions.allow."
}

select_install_mode() {
  SELECTED_OPTION=""
  select_arrow_option "В каком режиме установить доску sdd?" 0 \
    "Аналитик/разработчик" "Эксперт УЭК"
  INSTALL_MODE="$SELECTED_OPTION"
  SELECTED_OPTION=""
  printf 'Выбран режим установки: %s\n' "$INSTALL_MODE"
}

install_board() {
  local mode="$1"

  printf '%s\n' "Общие шаги установки будут выполнены в этом потоке."
  printf '%s\n' "Дополнительные зависимости для режима пока не настроены."
}

select_checkboxes() {
  local prompt="$1"
  shift
  local -a labels=("$@")
  local -a selected
  local cursor=0
  local key rest
  local index

  for index in "${!labels[@]}"; do
    selected[$index]=0
  done

  render() {
    local i
    for i in "${!labels[@]}"; do
      local marker
      if [[ "${selected[$i]}" -eq 1 ]]; then
        marker="[x]"
      else
        marker="[ ]"
      fi
      if [[ "$i" -eq "$cursor" ]]; then
        printf '\033[1m❯ %s %s\033[0m\n' "$marker" "${labels[$i]}" >&2
      else
        printf '  %s %s\n' "$marker" "${labels[$i]}" >&2
      fi
    done
  }

  {
    printf '%s\n' "$prompt"
    printf '%s\n' "Отмечайте пробелом, подтвердите Enter."
    printf '\033[?25l'
  } >&2

  render
  while true; do
    if ! IFS= read -rsn1 key; then
      printf '\033[?25h\n' >&2
      SELECTED_CHECKBOXES=()
      return 1
    fi
    if [[ "$key" == $'\x1b' ]]; then
      IFS= read -rsn2 -t 1 rest || true
      case "$rest" in
        '[A') cursor=$(( (cursor + ${#labels[@]} - 1) % ${#labels[@]} )) ;;
        '[B') cursor=$(( (cursor + 1) % ${#labels[@]} )) ;;
        *) continue ;;
      esac
      printf '\033[%dA' "${#labels[@]}" >&2
      render
    elif [[ "$key" == " " ]]; then
      if [[ "${selected[$cursor]}" -eq 1 ]]; then
        selected[$cursor]=0
      else
        selected[$cursor]=1
      fi
      printf '\033[%dA' "${#labels[@]}" >&2
      render
    elif [[ -z "$key" || "$key" == $'\n' || "$key" == $'\r' ]]; then
      printf '\033[?25h\n' >&2
      SELECTED_CHECKBOXES=()
      for index in "${!selected[@]}"; do
        if [[ "${selected[$index]}" -eq 1 ]]; then
          SELECTED_CHECKBOXES+=("${labels[$index]}")
        fi
      done
      return 0
    fi
  done
}

install_sbertrack_mcp() {
  printf '%s\n' "Установка sbertrack-mcp пока не реализована."
}

install_bitbucket_mcp() {
  printf '%s\n' "Установка bitbucket-mcp пока не реализована."
}

install_sourcecontrol_mcp() {
  local sc_token
  printf '%s' "Введите токен sourcecontrol: "
  IFS= read -r -s sc_token
  printf '\n'

  if [[ -z "$sc_token" ]]; then
    printf '%s\n' "Токен sourcecontrol не может быть пустым — установка остановлена." >&2
    return 1
  fi

  if ! command -v git >/dev/null 2>&1; then
    printf '%s\n' "Для клонирования MCP sourcecontrol требуется git." >&2
    return 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    printf '%s\n' "Для сборки MCP sourcecontrol требуется npm." >&2
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    printf '%s\n' "Для обновления .gigacode/settings.json требуется Node.js." >&2
    return 1
  fi

  local local_dir="$MCP_SOURCECONTROL_LOCAL_DIR"
  local repo_url="$MCP_SOURCECONTROL_REPO_URL"
  local entry="$MCP_SOURCECONTROL_ENTRY"

  if [[ -e "$local_dir" ]]; then
    if [[ -d "$local_dir/.git" ]]; then
      printf '%s\n' "Каталог $local_dir уже содержит git-репозиторий — пропускаю клон."
    else
      printf '%s\n' "Каталог $local_dir существует, но не является git-репозиторием." >&2
      return 1
    fi
  else
    mkdir -p "$(dirname "$local_dir")"
    printf '%s\n' "Клонирую $repo_url в $local_dir ..."
    if ! git clone --depth 1 "$repo_url" "$local_dir"; then
      printf '%s\n' "Не удалось склонировать $repo_url — установка остановлена." >&2
      return 1
    fi
  fi

  printf '%s\n' "Запускаю npm install и npm run build в $local_dir ..."
  if ! (
    cd "$local_dir"
    npm install
    npm run build
  ); then
    printf '%s\n' "Сборка $local_dir завершилась с ошибкой — установка остановлена." >&2
    return 1
  fi

  local entry_path="$local_dir/$entry"
  if [[ ! -f "$entry_path" ]]; then
    printf '%s\n' "После сборки не найден $entry_path — установка остановлена." >&2
    return 1
  fi

  local settings_dir="$HOME/.gigacode"
  local settings_file="$settings_dir/settings.json"
  mkdir -p "$settings_dir"

  SDD_SC_TOKEN="$sc_token" \
    SDD_SC_ENTRY="$entry_path" \
    SDD_SC_API_URL="$MCP_SOURCECONTROL_API_URL" \
    SETTINGS_FILE="$settings_file" \
    node <<'NODE'
const fs = require("fs");
const path = require("path");

const settingsFile = process.env.SETTINGS_FILE;
const scToken = process.env.SDD_SC_TOKEN;
const scEntry = process.env.SDD_SC_ENTRY;
const scApiUrl = process.env.SDD_SC_API_URL;

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

settings.mcpServers.sourcecontrol = {
  command: "node",
  args: [scEntry],
  env: {
    SC_API_URL: scApiUrl,
    SC_TOKEN: scToken,
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

  unset sc_token
  printf '%s\n' "MCP-сервер sourcecontrol добавлен в $settings_file."
}

install_selected_mcps() {
  SELECTED_CHECKBOXES=()
  select_checkboxes "Какие MCP-серверы установить?" \
    "jira" "sbertrack" "bitbucket" "sourcecontrol"
  local -a chosen=("${SELECTED_CHECKBOXES[@]}")
  SELECTED_CHECKBOXES=()
  if [[ "${#chosen[@]}" -eq 0 ]]; then
    printf '%s\n' "Ни один MCP-сервер не выбран."
    return 0
  fi
  for name in "${chosen[@]}"; do
    case "$name" in
      jira)
        if ! install_jira_mcp; then
          printf '%s\n' "Установка jira-mcp не завершена — продолжаю." >&2
        fi
        ;;
      sbertrack)
        if ! install_sbertrack_mcp; then
          printf '%s\n' "Установка sbertrack-mcp не завершена — продолжаю." >&2
        fi
        ;;
      bitbucket)
        if ! install_bitbucket_mcp; then
          printf '%s\n' "Установка bitbucket-mcp не завершена — продолжаю." >&2
        fi
        ;;
      sourcecontrol)
        if ! install_sourcecontrol_mcp; then
          printf '%s\n' "Установка sourcecontrol-mcp не завершена — продолжаю." >&2
        fi
        ;;
      *)
        printf '%s\n' "Неизвестный сервер: $name" >&2
        ;;
    esac
  done
}

main() {
  show_installation_info
  install_selected_mcps
  select_install_mode
  install_board "$INSTALL_MODE"
}

main "$@"
