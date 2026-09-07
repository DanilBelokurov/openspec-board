#!/usr/bin/env bash
# Thin shim around the Node.js installer. The actual logic lives in
# scripts/install/src/cli.ts and is compiled to scripts/install/dist/cli.js.
# Run `npm run build:installer` after editing the TypeScript sources.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
INSTALLER_DIST="$SCRIPT_DIR/install/dist/cli.js"

if [[ ! -f "$INSTALLER_DIST" ]]; then
  printf 'Не найден скомпилированный инсталлятор: %s\n' "$INSTALLER_DIST" >&2
  printf 'Выполните сборку: npm run build:installer\n' >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf 'Для запуска инсталлятора требуется Node.js.\n' >&2
  exit 1
fi

exec node "$INSTALLER_DIST" "$@"