#!/usr/bin/env bash
# Check that scripts/mutation-diff.sh still catches a removed test.
#
# Usage: scripts/mutation-guard.sh
#
# A new mutator can change its report or its snapshots so that the review
# quietly stops finding anything. This copies the files git sees in this
# checkout (tracked and untracked, not ignored) into a temporary repository,
# commits them as origin/main, and runs scripts/mutation-diff.sh twice:
#
# 1. With no change, it must exit 0.
# 2. After deleting src/core/tabs.test.ts, it must exit 1 with a
#    "テストが弱くなった" error.
#
# The temporary repository gets its own .git; lefthook is not installed there
# (--ignore-scripts), so this checkout's .git/hooks stay as they are. CI runs
# this in the mutation job, so a pull request that updates mutator runs it.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
work=$(mktemp -d "${TMPDIR:-/tmp}/mutation-guard.XXXXXX")
trap 'rm -rf "$work"' EXIT
trap 'exit 130' INT TERM
repo="$work/repo"
mkdir "$repo"

started=$(date +%s)
(
  cd "$root"
  git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' file; do
    if [ -f "$file" ]; then printf '%s\0' "$file"; fi
  done | tar --null -T - -cf -
) | tar -xf - -C "$repo"

cd "$repo"
git init --quiet --initial-branch=main
git add -A
git -c user.name=guard -c user.email=guard@example.invalid -c commit.gpgsign=false \
  commit --quiet --no-verify -m base
git update-ref refs/remotes/origin/main HEAD
pnpm install --frozen-lockfile --offline --ignore-scripts >"$work/install.log" 2>&1 ||
  { cat "$work/install.log" >&2; exit 1; }
pnpm exec wxt prepare >/dev/null

failed=0
if bash scripts/mutation-diff.sh origin/main >"$work/unchanged.log" 2>&1; then
  echo "mutation-guard: no change: exit 0 (expected)"
else
  echo "::error title=ミューテーションテストの見張りが失敗した::変更の無いブランチで、scripts/mutation-diff.shが失敗しました。"
  tail -n 40 "$work/unchanged.log" >&2
  failed=1
fi

git rm --quiet src/core/tabs.test.ts
git -c user.name=guard -c user.email=guard@example.invalid -c commit.gpgsign=false \
  commit --quiet --no-verify -m "remove a test"
status=0
bash scripts/mutation-diff.sh origin/main >"$work/removed.log" 2>&1 || status=$?
if [ "$status" -eq 1 ] && grep -q '^::error .*title=テストが弱くなった::' "$work/removed.log"; then
  echo "mutation-guard: removed test: exit 1 with テストが弱くなった (expected)"
else
  echo "::error title=ミューテーションテストの見張りが失敗した::テストを消しても、scripts/mutation-diff.shがテストが弱くなったと判定しません（終了コード${status}）。mutatorのレポートやsnapshotの形が変わっていないかを確かめてください。"
  tail -n 40 "$work/removed.log" >&2
  failed=1
fi

echo "mutation-guard: done in $(($(date +%s) - started))s"
exit "$failed"
