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
#    lockfiles, tsconfig.json, pnpm-workspace.yaml and each Vitest project's
#    config file, setupFiles and globalSetup (node_modules/@mizchi/mutator/
#    src/reuse.ts and the Vitest session's configFiles). The Vitest files are
#    resolved from the config by scripts/mutation-scope.ts. Copying them
#    makes the baseline's hash equal this checkout's, so a change to them
#    cannot turn the comparison off.
# 3. Install offline, prepare WXT and run every mutant there.
# 4. With the base's own Vitest and mutator settings, list the test files
#    Vitest collected and the files mutator mutated at the base. Fail when one
#    still exists (under its new name after a rename) but the current
#    settings leave it out: narrowing include / exclude drops it from the
#    baseline and the change alike, so nothing would look weaker.
# 5. Replace this checkout's .mutator with the baseline's snapshots, run the
#    mutants of the diff and of the changed tests, and review the report with
#    scripts/check-mutation-findings.ts. Besides mutator's own regressions, it
#    compares the baseline's report with the current one: mutator counts only
#    a `Killed` baseline verdict, and a busy machine can turn one into
#    `Timeout`. Then scripts/mutation-recheck.ts runs again, without the
#    previous results, the mutants whose baseline killers mix changed and
#    unchanged tests (an unrelated test that failed by chance keeps mutator's
#    previous verdict).
#
# Exit codes: 0 when the tests kept their strength. 1 when the tests got
# weaker or left out, when no baseline could be made (e.g. the base's tests fail with this
# checkout's dependencies), when mutator could not use the baseline it was
# given, or when the run itself failed. A missing baseline fails because
# letting it pass would let a change that breaks the base's tests (a new
# setup file, say) remove tests unnoticed; a dependency update that breaks
# the tests fails the ordinary test job as well.
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

# Escape a value for the message of a workflow command.
escape_data() {
  local text=${1//'%'/%25}
  text=${text//$'\r'/%0D}
  printf '%s' "${text//$'\n'/%0A}"
}

no_baseline() {
  local excerpt
  excerpt=$(grep -v '^[[:space:]]*$' "$work/baseline.log" | tail -n 8 | cut -c1-300 || true)
  echo "::error title=ミューテーションテストの基準を作れない::$(escape_data "${merge_base}（${base}との共通の祖先）で$1。テストが弱くなったかを確かめられないため、失敗にします。依存を更新してテストが壊れたなら、まず通常のテスト（pnpm test）を直してください。VitestのsetupFiles / globalSetupや、テストが読む設定ファイルを足したなら、上の「mutation:diff: copied」の行にそれが入っているかを確かめ、入っていなければscripts/mutation-diff.shが基準へ写すファイルに足してください。出力の末尾:
${excerpt}")"
  echo "--- baseline log (last 40 lines) ---" >&2
  tail -n 40 "$work/baseline.log" >&2 || true
  exit 1
}

started=$(date +%s)
echo "mutation:diff: making the baseline at ${merge_base} (${base})"
: >"$work/baseline.log"
if ! git worktree add --detach --quiet "$tree" "$merge_base" >>"$work/baseline.log" 2>&1; then
  no_baseline "worktreeを作れません"
fi

# Vitest's files (config, setupFiles, globalSetup), the test files it
# collects and the files mutator mutates, with this checkout's settings.
scope() {
  node --experimental-strip-types --disable-warning=ExperimentalWarning \
    "$root/scripts/mutation-scope.ts" "$@"
}
if ! scope list --root "$root" >"$work/current.json" 2>"$work/scope.log"; then
  echo "::error title=テストの設定を読めない::$(escape_data "scripts/mutation-scope.tsが失敗しました: $(tail -n 5 "$work/scope.log")")"
  exit 1
fi
mapfile -t vitest_files < <(node -e 'for (const f of JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).configFiles) console.log(f)' "$work/current.json")

# The base's own settings, kept to list what the base collected (step 4).
mkdir -p "$work/base-config"
shopt -s nullglob
for file in "$tree"/vitest.config.* "$tree"/mutator.config.*; do
  cp "$file" "$work/base-config/"
done

# The files in mutator's environment hash, plus .npmrc, which decides how the
# baseline installs.
for file in "$tree"/package.json "$tree"/pnpm-lock.yaml "$tree"/pnpm-workspace.yaml \
  "$tree"/.npmrc "$tree"/tsconfig*.json "$tree"/vitest.config.* "$tree"/mutator.config.*; do
  rm -f "$file"
done
for file in package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc \
  tsconfig*.json vitest.config.* mutator.config.*; do
  if [ -f "$file" ]; then cp "$file" "$tree/$file"; fi
done
shopt -u nullglob
for file in "${vitest_files[@]}"; do
  mkdir -p "$tree/$(dirname "$file")"
  cp "$file" "$tree/$file"
done
echo "mutation:diff: copied" package.json pnpm-lock.yaml pnpm-workspace.yaml \
  .npmrc 'tsconfig*.json' 'vitest.config.*' 'mutator.config.*' "${vitest_files[@]}"

# --ignore-scripts keeps `prepare` (lefthook install) from rewriting this
# checkout's .git/hooks, which the worktree shares.
if ! (cd "$tree" && pnpm install --frozen-lockfile --offline --ignore-scripts) >>"$work/baseline.log" 2>&1; then
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
# The baseline's own report, for the cross-check in check-mutation-findings.ts.
if ! cp "$tree/.mutator/report/mutation.json" "$work/base-report.json" ||
  ! cp "$tree/.mutator/snapshot.json" "$work/base-snapshot.json"; then
  no_baseline "基準のレポートかsnapshot（.mutator/report/mutation.json、.mutator/snapshot.json）がありません"
fi

# What the base collected with its own settings. The saved config files go
# back into the worktree under other names, so their imports still resolve
# from there; without one, Vitest runs without a config and mutator with its
# defaults.
base_vitest=none
base_mutator=none
shopt -s nullglob
for file in "$work"/base-config/vitest.config.*; do
  base_vitest="$tree/.mutation-base-vitest.${file##*/vitest.}"
  cp "$file" "$base_vitest"
  break
done
for file in "$work"/base-config/mutator.config.*; do
  base_mutator="$tree/.mutation-base-mutator.${file##*/mutator.}"
  cp "$file" "$base_mutator"
  break
done
if [ "$base_vitest" = none ]; then
  for file in "$tree"/vite.config.*; do base_vitest=$file; break; done
fi
shopt -u nullglob
if ! scope list --root "$tree" --vitest-config "$base_vitest" --mutator-config "$base_mutator" \
  >"$work/base.json" 2>>"$work/baseline.log"; then
  no_baseline "基準の設定で、テストファイルとミューテーションテストの対象を一覧にできません"
fi
scope_status=0
scope compare "$work/base.json" "$work/current.json" "$merge_base" || scope_status=$?

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
watch_args=()
for file in "${vitest_files[@]}"; do watch_args+=(--watch "$file"); done
status=0
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  scripts/check-mutation-findings.ts "$merge_base" "${watch_args[@]}" \
  --base-report "$work/base-report.json" || status=$?
# mutator keeps a baseline Killed while any of its killers is unchanged, so an
# unrelated test that failed by chance in the baseline can hide a weakened
# test. Those mutants run again without the previous results.
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  scripts/mutation-recheck.ts "$work" || status=1
echo "mutation:diff: done in $(($(date +%s) - started))s"
if [ "$scope_status" -ne 0 ]; then exit 1; fi
exit "$status"
