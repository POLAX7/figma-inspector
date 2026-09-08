#!/usr/bin/env bash
set -euo pipefail

pnpm build

package_dir="$(pwd)/packages/cli"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

pnpm --dir "$package_dir" pack --pack-destination "$tmp_dir"
tarball="$(find "$tmp_dir" -maxdepth 1 -name '*.tgz' -print -quit)"

pnpm add --global "$tarball"
