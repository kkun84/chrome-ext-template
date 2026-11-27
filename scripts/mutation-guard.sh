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
# 8. After deleting a test and turning on noUnusedParameters in
#    tsconfig.json, which turns the mutants only that test detected into
#    CompileError in the baseline and the change alike (the baseline gets
#    the new tsconfig.json), likewise. The base turns the option off for
#    this case.
# 9. After pointing mutator at another Vitest config that leaves out the
#    helper's test and weakening the helper, it must exit 1 with a
#    "判定で使えない設定がある" error.
# 10. With sharedCache in mutator.config.json, likewise.
# 11. After narrowing the return type of a function next to a constant
#    (the constant's mutant, which the diff does not select, then no longer
#    type-checks), it must exit 0.
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
# Case 8: a function whose mutants that drop the use of its parameter only
# the first test detects, and which noUnusedParameters makes CompileError.
kind=src/core/mutation-guard-kind
cat >"$kind.ts" <<'TS'
export const kind = (text: string): string => {
  if (text.length === 0) {
    return "empty";
  }
  return "text";
};
TS
cat >"$kind.test.ts" <<'TS'
import { expect, it } from "vitest";
import { kind } from "./mutation-guard-kind.js";

it("names text", () => {
  expect(kind("a")).toBe("text");
});

it("names nothing", () => {
  expect(kind("")).toBe("empty");
});

it("never names text with nothing", () => {
  expect(kind("b")).not.toBe("");
});
TS
sed -i 's/"noUnusedParameters": true/"noUnusedParameters": false/' tsconfig.json
# Case 11: a constant that only the test of label detects.
folder=src/core/mutation-guard-folder
cat >"$folder.ts" <<'TS'
export const FOLDER = "notes";

export const label = (): string => FOLDER;
TS
cat >"$folder.test.ts" <<'TS'
import { expect, it } from "vitest";
import { label } from "./mutation-guard-folder.js";

it("names the folder", () => {
  expect(label()).toBe("notes");
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
start tsconfig
sed -i 's/"noUnusedParameters": false/"noUnusedParameters": true/' tsconfig.json
sed -i '/^it("names text"/,/^});$/d' "$kind.test.ts"
expect tsconfig 1 "設定の変更で、変えたテストが確かめるミュータントが外れた"
start vitest-config
cat >vitest.config.alt.ts <<'TS'
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/core/mutation-guard-digits.test.ts"],
    environment: "node",
  },
});
TS
configure '{"vitestConfig": "vitest.config.alt.ts"}'
sed -i 's/toBe(want)/toBeDefined()/' "$helper.ts"
expect vitest-config 1 "判定で使えない設定がある"
start shared-cache
configure '{"sharedCache": true}'
expect shared-cache 1 "判定で使えない設定がある"
start narrowed-type
sed -i 's/(): string => FOLDER/(): "notes" => FOLDER/' "$folder.ts"
expect narrowed-type 0

echo "mutation-guard: done in $(($(date +%s) - started))s"
exit "$failed"
