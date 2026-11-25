#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
plugins_dir="${ANTIGRAVITY_PLUGINS_DIR:-$HOME/.gemini/config/plugins}"
target="${plugins_dir}/beads-tasks"
case "${1:---copy}" in
  --uninstall) rm -rf "$target"; printf 'Removed %s\n' "$target" ;;
  --symlink) mkdir -p "$plugins_dir"; rm -rf "$target"; ln -s "$repo_root" "$target"; printf 'Linked %s\n' "$target" ;;
  --copy) mkdir -p "$plugins_dir"; rm -rf "$target"; mkdir -p "$target"; tar -C "$repo_root" --exclude='./.git' --exclude='node_modules' --exclude='./.github' -cf - . | tar -C "$target" -xf -; printf 'Installed %s\n' "$target" ;;
  *) printf 'Usage: %s [--copy|--symlink|--uninstall]\n' "$0" >&2; exit 2 ;;
esac
