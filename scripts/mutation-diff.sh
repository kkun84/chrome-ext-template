#!/usr/bin/env bash
# Fail when a change weakened the tests, judged by mutation testing.
#
# Usage: scripts/mutation-diff.sh [--kill-matrix] [--skip-without-base] <base-ref>
#
# The baseline is made fresh on every run instead of reusing the last run's
# .mutator, which may come from another branch or another environment:
#
# 1. Check out `git merge-base <base-ref> HEAD` into a temporary worktree.
# 2. Copy this checkout's environment files over it. mutator reuses a snapshot
#    only when its environment hash matches: process.version, the mutation
#    settings in mutator.config.*, and the content of package.json, the
#    lockfiles, tsconfig.json, pnpm-workspace.yaml and the Vitest config files
#    (node_modules/@mizchi/mutator/src/reuse.ts and the Vitest session's
#    configFiles). Copying them makes the baseline's hash equal this
#    checkout's, so a change to them cannot turn the comparison off.
# 3. Install offline, prepare WXT and run every mutant there.
# 4. Replace this checkout's .mutator with the baseline's snapshots, run the
#    mutants of the diff and of the changed tests, and review the report with
#    scripts/check-mutation-findings.ts.
#
# Exit codes: 0 when the tests kept their strength, or when no baseline could
# be made (a warning says why; e.g. the base's tests fail with this checkout's
# dependencies). 1 when the tests got weaker, when mutator could not use the
# baseline it was given, or when the run itself failed.
#
# --kill-matrix also runs every covering test per mutant, which reports new
# tests that detect nothing. --skip-without-base exits 0 when <base-ref> does
# not exist (a clone without origin/main) or there is no git repository.
set -euo pipefail

kill_matrix=()
skip_without_base=false
base=""
for arg in "$@"; do
  case "$arg" in
    --kill-matrix) kill_matrix=(--kill-matrix) ;;
    --skip-without-base) skip_without_base=true ;;
    -*)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
    *) base="$arg" ;;
  esac
done
if [ -z "$base" ]; then
  echo "usage: $0 [--kill-matrix] [--skip-without-base] <base-ref>" >&2
  exit 2
fi

if ! root=$(git rev-parse --show-toplevel 2>/dev/null); then
  if [ "$skip_without_base" = true ]; then
    echo "skipping mutation:diff: not a git repository"
    exit 0
  fi
  echo "::error title=Gitのリポジトリではない::scripts/mutation-diff.shはGitのリポジトリの中で実行してください。"
  exit 1
fi
cd "$root"

if ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null; then
  if [ "$skip_without_base" = true ]; then
    echo "skipping mutation:diff: ${base} not found"
    exit 0
  fi
  echo "::error title=基準のrefが無い::${base}がありません。refの名前と、履歴を取得しているか（CIではfetch-depth: 0）を確かめてください。"
  exit 1
fi
if ! merge_base=$(git merge-base "$base" HEAD); then
  echo "::error title=基準のコミットが無い::${base}とHEADの共通の祖先がありません。履歴を取得しているか（CIではfetch-depth: 0）を確かめてください。"
  exit 1
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/mutation-base.XXXXXX")
tree="$work/tree"
# Remove the worktree however the script ends. Its node_modules is untracked,
# hence --force.
trap 'git -C "$root" worktree remove --force "$tree" >/dev/null 2>&1 || true
rm -rf "$work"
git -C "$root" worktree prune' EXIT
trap 'exit 130' INT TERM

no_baseline() {
  echo "::warning title=ミューテーションテストの基準を作れない::${merge_base}（${base}との共通の祖先）で$1。テストが弱くなったかは確かめていません。"
  tail -n 40 "$work/baseline.log" >&2 || true
  exit 0
}

started=$(date +%s)
echo "mutation:diff: making the baseline at ${merge_base} (${base})"
git worktree add --detach --quiet "$tree" "$merge_base"

# The files in mutator's environment hash, plus .npmrc, which decides how the
# baseline installs. A Vitest setupFiles / globalSetup file is in the hash as
# well; add it here when vitest.config.ts gains one, or the check fails with
# "比べる基準を使えなかった".
shopt -s nullglob
for file in "$tree"/package.json "$tree"/pnpm-lock.yaml "$tree"/pnpm-workspace.yaml \
  "$tree"/.npmrc "$tree"/tsconfig*.json "$tree"/vitest.config.* "$tree"/mutator.config.*; do
  rm -f "$file"
done
for file in package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc \
  tsconfig*.json vitest.config.* mutator.config.*; do
  if [ -f "$file" ]; then cp "$file" "$tree/$file"; fi
done
shopt -u nullglob

# --ignore-scripts keeps `prepare` (lefthook install) from rewriting this
# checkout's .git/hooks, which the worktree shares.
if ! (cd "$tree" && pnpm install --frozen-lockfile --offline --ignore-scripts) >"$work/baseline.log" 2>&1; then
  no_baseline "依存を入れられません"
fi
# Vitest loads tsconfig.json, which extends the generated .wxt/tsconfig.json.
if ! (cd "$tree" && pnpm exec wxt prepare) >>"$work/baseline.log" 2>&1; then
  no_baseline "wxt prepareが失敗しました"
fi
# GITHUB_ACTIONS is cleared so mutator writes no annotations of its own:
# check-mutation-findings.ts writes them.
if ! (cd "$tree" && GITHUB_ACTIONS='' pnpm exec mutator --reporter json) >>"$work/baseline.log" 2>&1; then
  no_baseline "全件のミューテーションテストが失敗しました（今の依存でベースのテストが落ちる、など）"
fi
echo "mutation:diff: baseline made in $(($(date +%s) - started))s"

# Only the snapshots: scopes/*.json and snapshot.json. Reports, the resume
# checkpoints and the old .mutator of this checkout are dropped.
rm -rf .mutator
mkdir -p .mutator/scopes
for snapshot in "$tree"/.mutator/scopes/*.json; do cp "$snapshot" .mutator/scopes/; done
if [ -f "$tree/.mutator/snapshot.json" ]; then cp "$tree/.mutator/snapshot.json" .mutator/; fi

if ! GITHUB_ACTIONS='' pnpm exec mutator --since "$merge_base" --include-test-changes "${kill_matrix[@]}"; then
  echo "::error title=ミューテーションテストが失敗した::mutator --since ${merge_base}が失敗しました。上の出力を確かめてください。"
  exit 1
fi
status=0
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  scripts/check-mutation-findings.ts "$merge_base" || status=$?
echo "mutation:diff: done in $(($(date +%s) - started))s"
exit "$status"
