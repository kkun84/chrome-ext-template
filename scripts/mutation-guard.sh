#!/usr/bin/env bash
# Check that scripts/mutation-diff.sh still catches weakened tests.
#
# Usage: scripts/mutation-guard.sh
#
# A new mutator can change its report or its snapshots so that the review
# quietly stops finding anything. This copies the files git sees in this
# checkout (tracked and untracked, not ignored) into a temporary repository,
# adds small samples of its own (src/core/mutation-guard-*.ts and their tests,
# so it does not depend on the template's own code), commits them as
# origin/main, and runs scripts/mutation-diff.sh on a branch from there for
# each case:
#
# 1. With no change, it must exit 0.
# 2. After deleting the sample's test, it must exit 1 with a
#    "テストが弱くなった" error.
# 3. After removing the assertions that detect the mutants of a regular
#    expression built at module level (no test covers such a mutant, so
#    --include-test-changes does not select it), it must exit 1 with a
#    "テストが弱くなった" error.
# 4. After weakening the expect inside a test helper (the test file itself
#    does not change), likewise.
# 5. After weakening the assertions and setting a timeBudget of 0 in
#    mutator.config.json, which leaves the baseline Pending, it must exit 1
#    with a "実行されなかったミュータントがある" error.
# 6. After weakening the assertions and setting since, which would turn the
#    baseline into a run of the diff, it must exit 1 with a
#    "基準の全件を打ち切る設定がある" error.
# 7. After deleting the sample's test and excluding the Regex mutator, which
#    takes the mutants the test detected out of both the baseline and the
#    change, it must exit 1 with a
#    "設定の変更で、変えたテストが確かめるミュータントが外れた" error.
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
# A second sample whose test checks it only through a helper.
digits=src/core/mutation-guard-digits
helper=src/core/mutation-guard-helper
cat >"$digits.ts" <<'TS'
// A sample for scripts/mutation-guard.sh. The pattern is built at module level.
const DIGITS = /^[0-9]+$/u;

export const isDigits = (text: string): boolean => DIGITS.test(text);
TS
cat >"$helper.ts" <<'TS'
import { expect } from "vitest";
import { isDigits } from "./mutation-guard-digits.js";

export const expectDigits = (text: string, want: boolean): void => {
  expect(isDigits(text)).toBe(want);
};
TS
cat >"$digits.test.ts" <<'TS'
import { it } from "vitest";
import { expectDigits } from "./mutation-guard-helper.js";

it("accepts digits", () => {
  expectDigits("123", true);
});

it("rejects anything else", () => {
  expectDigits("", false);
  expectDigits("a12", false);
  expectDigits("12a", false);
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

# Merge settings into mutator.config.json.
configure() {
  node -e 'const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync("mutator.config.json", "utf8"));
fs.writeFileSync("mutator.config.json", JSON.stringify({ ...config, ...JSON.parse(process.argv[1]) }, null, 2) + "\n");' "$1"
}
weaken() { sed -i '/toBe(false)/d' "$sample.test.ts"; }

failed=0
# expect <name> <exit code> [title]: commit the changes on a branch from
# origin/main, run mutation-diff.sh and check the result.
expect() {
  local name=$1 want=$2 title=${3:-} status=0
  git add -A
  commit --allow-empty -m "$name"
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
# start <name>: a clean branch from origin/main for the next case.
start() { git checkout --quiet --force -B "$1" main; }

start no-change
expect no-change 0
start removed-test
git rm --quiet "$sample.test.ts"
expect removed-test 1 "テストが弱くなった"
start weakened-module-level
weaken
expect weakened-module-level 1 "テストが弱くなった"
start weakened-helper
sed -i 's/toBe(want)/toBeDefined()/' "$helper.ts"
expect weakened-helper 1 "テストが弱くなった"
start time-budget
weaken
configure '{"timeBudget": 0}'
expect time-budget 1 "実行されなかったミュータントがある"
start since
weaken
configure '{"since": "HEAD"}'
expect since 1 "基準の全件を打ち切る設定がある"
start excluded-mutator
git rm --quiet "$sample.test.ts"
configure '{"excludedMutators": ["Regex"]}'
expect excluded-mutator 1 "設定の変更で、変えたテストが確かめるミュータントが外れた"

echo "mutation-guard: done in $(($(date +%s) - started))s"
exit "$failed"
