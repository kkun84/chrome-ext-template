#!/usr/bin/env bash
# Check that scripts/mutation-diff.sh still catches weakened tests.
#
# Usage: scripts/mutation-guard.sh
#
# A new mutator can change its report or its snapshots so that the review
# quietly stops finding anything. This copies the files git sees in this
# checkout (tracked and untracked, not ignored) into a temporary repository,
# adds a small sample of its own (src/core/mutation-guard-sample.ts and its
# test, so it does not depend on the template's own code), commits them as
# origin/main, and runs scripts/mutation-diff.sh three times:
#
# 1. With no change, it must exit 0.
# 2. After deleting the sample's test, it must exit 1 with a
#    "テストが弱くなった" error.
# 3. After removing the assertions that detect the mutants of a regular
#    expression built at module level (no test covers such a mutant, so
#    --include-test-changes does not select it), it must exit 1 with a
#    "テストが弱くなった" error.
#
# The temporary repository gets its own .git; lefthook is not installed there
# (--ignore-scripts), so this checkout's .git/hooks stay as they are. CI runs
# this in the mutation job on every event, so a pull request that updates
# mutator runs it.
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
sample=src/core/mutation-guard-sample
mkdir -p src/core
cat >"$sample.ts" <<'TS'
// A sample for scripts/mutation-guard.sh. The pattern is built at module level.
const WORD = /^[a-z]+$/u;

export const isWord = (text: string): boolean => WORD.test(text);
TS
cat >"$sample.test.ts" <<'TS'
import { expect, it } from "vitest";
import { isWord } from "./mutation-guard-sample.js";

it("accepts lowercase letters", () => {
  expect(isWord("abc")).toBe(true);
});

it("rejects anything else", () => {
  expect(isWord("")).toBe(false);
  expect(isWord("1abc")).toBe(false);
  expect(isWord("abc1")).toBe(false);
  expect(isWord("aBc")).toBe(false);
});
TS
commit() {
  git -c user.name=guard -c user.email=guard@example.invalid -c commit.gpgsign=false \
    commit --quiet --no-verify "$@"
}
git init --quiet --initial-branch=main
git add -A
commit -m base
git update-ref refs/remotes/origin/main HEAD
pnpm install --frozen-lockfile --offline --ignore-scripts >"$work/install.log" 2>&1 ||
  { cat "$work/install.log" >&2; exit 1; }
pnpm exec wxt prepare >/dev/null

failed=0
# expect <name> <exit code> [title]: run mutation-diff.sh and check the result.
expect() {
  local name=$1 want=$2 title=${3:-} status=0
  bash scripts/mutation-diff.sh origin/main >"$work/$name.log" 2>&1 || status=$?
  if [ "$status" -eq "$want" ] &&
    { [ -z "$title" ] || grep -q "^::error .*title=${title}::" "$work/$name.log"; }; then
    echo "mutation-guard: ${name}: exit ${status} (expected)"
  else
    echo "::error title=ミューテーションテストの見張りが失敗した::${name}で、scripts/mutation-diff.shの終了コードが${status}でした（期待は${want}${title:+、注釈は${title}}）。mutatorのレポートやsnapshotの形が変わっていないかを確かめてください。"
    tail -n 40 "$work/$name.log" >&2
    failed=1
  fi
}

expect no-change 0
git rm --quiet "$sample.test.ts"
commit -m "remove the sample's test"
expect removed-test 1 "テストが弱くなった"
git checkout --quiet HEAD~1 -- "$sample.test.ts"
sed -i '/toBe(false)/d' "$sample.test.ts"
git add "$sample.test.ts"
commit -m "weaken the sample's test"
expect weakened-module-level 1 "テストが弱くなった"

echo "mutation-guard: done in $(($(date +%s) - started))s"
exit "$failed"
