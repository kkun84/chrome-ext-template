# AGENTS.md — AIエージェント向け実装規約

このリポジトリはChrome MV3拡張の雛形です。以下を守って実装してください。

## 日本語と英語の間の空白（タイポグラフィ）

日本語と英数字の間に半角スペース（`U+0020`）を入れないでください。字間はレンダラーの仕事です。

- 対象: 日本語とASCII語の両方向（`日本語 URL`も`URL の`も禁止）。
- 例外: Markdownリンク / 画像の直後（`](...)` / `][ref]`）の空白は許可（例: `[Nix](https://nixos.org/) は`）。
- 例外: issue参照`#123`の直後の空白は許可（例: `#5 をマージ`）。ATX見出し`# 見出し`はこの例外ではない。
- コードスパン / コードブロック / URLの**内側**は変更しない。
- ただし、日本語と隣接するインラインコードスパン（バッククォート）の**外側**の空白は削除する。バッククォートをASCIIとして扱う。GitHub / CommonMarkのレンダリングは壊れない。
- 半角スペース`U+0020`のみが対象。全角スペース`U+3000`は日本語クラス側なので区切りにしない。

## レイヤーと依存の方向

```text
entrypoints  →  layers / services  →  core
```

- **`src/core`は純粋**。`chrome.*`、WXTの`browser`、`src/layers`、`src/services`を
  importしてはいけない。I/O・グローバル状態・`Date.now()`以外の副作用を持たない
  （時刻は引数で受け取る）。
- `src/services`は **Effect `Context.Service`のタグ（インターフェース）と
  ユースケース関数のみ**。実装を置かない。
- `src/layers`に **Live（`chrome.*`）実装** と **Test（インメモリ）実装** を置く。
- `entrypoints`は **薄いImperative Shell**。ロジックを書かず、ユースケースを呼ぶだけ。

## 新機能の置き場所

1. **domain** — `src/core`に純関数とSchemaを追加し、Vitestでテストする。
2. **service tag** — `src/services/services.ts`に必要な`Context.Service`を追加。
3. **layer** — `src/layers`にLive実装とTest実装を追加。
4. **entrypoint** — `src/entrypoints`からユースケースを呼ぶだけの薄いコード。

## 型 / Schema規約

- 名前的型は`Schema.brand`を使う（例: `SavedUrl`）。
- メッセージ・UI状態は`Schema.TaggedClass` / 判別可能なユニオンで表現する。
- 分岐は **網羅的に**（`Match.tagsExhaustive`など）。暗黙のフォールスルー禁止。
- **境界データは必ずSchemaでdecode** する:
  - `chrome.runtime.onMessage`のメッセージ
  - `chrome.storage`のペイロード
  - `chrome.tabs`から得たURL文字列
- 不正データは **投げずに型付きエラー**（`Schema.TaggedError`）または安全な既定値にする。

## テスト方針

- **`src/core`** はVitestの純関数ユニットテスト（I/Oなし）。
- **ユースケース** は`src/layers`のTestレイヤーを`Effect.provide`して検証する。
- **E2E** はビルド済み拡張を`--load-extension`で読み込み、Service Workerと
  ポップアップが到達可能であることを確認する（Playwright 1.59の公式パターン）。

## Definition of done

- 作業を終える前に **`pnpm check`**（`lint` + `typecheck` + `test` + `fallow` + `mutation:diff`）を
  実行し、通ることを確認する。
- リリース / CI相当のフル検証では **`pnpm check:all`**（`check` + `test:coverage` +
  `build` + `test:e2e` + `dedupe:check`）も実行する。

## Machine-enforced rules

規約は文章だけでなく、次のツールで機械的に強制されます（mutatorはテストを弱めた変更だけが`error`、他はすべて`error`）。

- **Biome**（`biome.json`、`pnpm lint` = `biome ci .`）:
  format / recommended lint、`noExplicitAny`（`any`禁止）、`noImplicitAnyLet`、
  `noConsole`、`noTsIgnore`、`noImportCycles`、`noNonNullAssertion`（`!`禁止）、
  `useImportType` / `useExportType`（型import/exportは`import type` / `export type`）、
  `noReExportAll`（`export *`禁止）、`noDefaultExport`（WXT entrypointsとconfigのみ
  overrideで許可）、`noNamespace`、`noCommonJs`、`useNodejsImportProtocol`、
  `noUnusedImports` / `noUnusedVariables`。レイヤー方向は`noRestrictedImports` /
  `noRestrictedGlobals`で強制（core: chrome/WXT/layers/services/entrypoints禁止、
  services: layers/entrypoints禁止、entrypoints: `src/core`直接import禁止）。
  assistのorganizeImportsも有効。
- **rumdl 0.3.2**（`.rumdl.toml`、`pnpm lint:md` = `rumdl check .`）: Markdownのlint。
  `flavor = "standard"`（GFM込み）。日本語ドキュメントのため`MD013`（行長）のみ無効化し、
  それ以外の既定ルールは有効のまま（`MD033`も有効）。
- **ja-space**（`scripts/lint-ja-space.ts`、`pnpm lint:ja-space`）: 上記の日本語タイポグラフィを
  機械的に強制する。`src`と`scripts`のTypeScriptはVitest（`scripts/ja-space.test.ts`等）で検証する。
  `pnpm lint` / `pnpm check`の一部として実行される。
- **pnpm-policy**（`scripts/lint-pnpm-policy.ts`、`pnpm lint:pnpm-policy`）:
  `pnpm-workspace.yaml` / `package.json`の`"pnpm"` / `.npmrc`で除外・無視キー
  （`minimumReleaseAgeExclude`等）を禁止し、必須設定（`minimumReleaseAge >= 10080`、
  `trustPolicy: no-downgrade`、`onlyBuiltDependencies: []`、`blockExoticSubdeps: true`）が
  欠落・緩和されていないか検証する。スクリプト / ワークフロー / `lefthook.yml`の禁止CLI
  オプションも検出する。`pnpm lint` / `pnpm check`の一部として実行される。
- **no-suppress**（`scripts/lint-no-suppress.ts`、`pnpm lint:no-suppress`）:
  `biome-ignore` / `@ts-expect-error` / `@ts-ignore` / `@ts-nocheck` /
  `eslint-disable` / `fallow-ignore` / `mutator-disable` / `Stryker disable`を**コメント**として書くことを禁止する（文字列や
  Markdownの説明は対象外）。`pnpm lint` / `pnpm check`の一部として実行される。
- **fallow**（`.fallowrc.json`、`pnpm fallow`）: デッドコード / 循環依存 / 重複 /
  ヘルスに加え、**architecture boundaries**（同じレイヤー方向。`entrypoints → layers /
  services → core`）と、coreゾーンでの禁止呼び出し（`Date.now`、`Math.random`、
  `chrome.*`、`browser.*`、`globalThis.chrome`）を検出する。`fallow audit`の
  `added-suppression`は`error`（新規の抑制コメントを拒否）。
- **mutator**（`mutator.config.json`）: `src/core` / `src/services`のミュータントを実行する。
  失敗にするのは、テストを弱めた変更。変わっていないコードのミュータントを基準ではテストが
  検出していたのに、今はどのテストも検出しない場合を指す（mutatorの`detectionRegression`）。
  `scripts/mutation-diff.sh`（`pnpm mutation:diff`）が、`git merge-base <base> HEAD`を一時的なworktreeに
  取り出し、今の作業ツリーの環境ファイル（`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、
  `.npmrc`、`tsconfig*.json`、`vitest.config.*`、`mutator.config.*`と、`scripts/mutation-scope.ts`が
  Vitestの設定から解決する設定ファイル・`setupFiles`・`globalSetup`）を上書きして全件を実行し、
  その結果を基準にする。基準の元の設定で集めていたテストファイルやmutatorの対象が、今も残っているのに
  今の設定で外れていれば失敗にする（改名はgitの対応付けで追う）。前回の`.mutator`は使わない。続けて差分と変更したテストの分を
  `--include-test-changes --kill-matrix`付きで実行し、`scripts/mutation-findings.ts`（純関数）と
  `scripts/check-mutation-findings.ts`（`pnpm mutation:findings`）が判定する。基準と今のレポートも
  突き合わせ、ソースが変わっていないファイルで基準では`Killed`（または、変更で説明できる`Timeout`）、
  今は`Survived` / `NoCoverage`のミュータントも失敗にする（負荷で基準が`Timeout`になった時の見逃しを防ぐ）。基準と比べられなかった
  レポート（`comparison: "unavailable"`）や、形の違うレポート、基準を作れない時（worktreeの準備や
  依存の導入に失敗した、ベースのテストが今の環境で落ちる、など）も失敗にする。何も検出しない新しいテスト（`newTestNoKills`）と
  検出できないミュータントは警告、全件のスコアは表示だけ。`pnpm check`（とpre-push）は`origin/main`を
  基準にし、無ければ飛ばす。CIの`mutation`ジョブはPRで同じスクリプトをベースブランチに対して実行する
  （マージに必須のチェック）。所要時間は20秒ほど。基準を作れないと言われたら、まず通常のテストを直す。
  テストが読むファイルを足したなら、`mutation:diff: copied`の行に入っているかを確かめ、無ければ
  `scripts/mutation-diff.sh`が写すファイルに足す。
  `src/core` / `src/services`を変えたら、`pnpm mutation:diff`の結果を見直す。検出できないミュータントは、
  テストが足りないのか、コードが要らないのかを判断する。テストを足すときは、呼び出す側から見える
  振る舞いを確かめる。ミュータントを落とすためだけに実装をなぞるテストは書かない。手順は
  `node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md`に従う。
  テストを弱めた変更と判定されたら、弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめる
  テストを足す。等価ミュータントだけを`pnpm exec mutator accept <key> --reason <理由>`で
  `mutator.accepted.json`に記録する（キーは`pnpm exec mutator --reporter agent`の`gaps[].key`）。
  テストを弱めた変更を通すために記録してはいけない。ミューテーションテストから外すものは、
  コメントではなく`mutator.config.json`の`exclude`に書く。PRで`mutator.config.*` /
  `mutator.accepted.json`、`vitest.config.*`、`setupFiles` / `globalSetup`を変えると警告を出す。
  これらと判定のスクリプト、`package.json`の`scripts`の変更は人が確かめる。mutatorを上げたら
  `pnpm test:mutation-guard`（CIの`mutation`ジョブが毎回実行）で、判定が外れていないかを確かめる。
  関数の書き換えと同時にテストを消すと警告だけになること、破壊的な依存の更新とテストの直しを同じPRに
  入れると必ず失敗すること（直しを先に`main`へ入れる）、テストが読むデータの変更は検出しないことは、
  READMEの「機械では確かめられないもの」を参照。
- **TypeScript**（`tsconfig.json`）: `strict`、`noUncheckedIndexedAccess`、
  `exactOptionalPropertyTypes`、`noImplicitOverride`、`noPropertyAccessFromIndexSignature`、
  `noFallthroughCasesInSwitch`、`useUnknownInCatchVariables`、`verbatimModuleSyntax`、
  `isolatedModules`、`noImplicitReturns`、`noUnusedLocals`、`noUnusedParameters`。
- **Vitest**（`vitest.config.ts`）: `src/core/**`にlines / branches / functions /
  statements 90% のカバレッジゲート（集計値。per-fileではない）。
- **lefthook**（`lefthook.yml`）: pre-commitはstagedファイルにBiome / rumdl（`**/*.md`） /
  日本語タイポグラフィの`--fix`、pre-pushは`pnpm check`。globは再帰形（`**/*.{...}`）で
  サブディレクトリのファイルも対象にする。
- **CI**（`.github/workflows/ci.yml`）: `pnpm lint`（`biome ci`）、fallow、typecheck、
  tests + coverage、mutation（PRではテストを弱めた変更で失敗。全件のスコアは表示だけ）、build、e2e、
  nix flake check + shellcheck/actionlint、
  `pnpm dedupe --check`。`pnpm audit`は週1回の定期実行だけで動く。

## よく使うコマンド

```bash
pnpm dev           # 開発（ブラウザ自動起動なし）
pnpm build         # 本番ビルド
pnpm zip           # 配布用 zip
pnpm typecheck     # wxt prepare + tsc
pnpm lint          # biome ci + rumdl check + ja-space + pnpm-policy + no-suppress
pnpm lint:md       # rumdl check .
pnpm lint:ja-space # 日本語と英語の間の空白を検査
pnpm lint:pnpm-policy # pnpmの供給網ポリシーを検査
pnpm lint:no-suppress # 抑制コメントを検査
pnpm lint:fix      # biome check --write + rumdl check --fix + ja-space --fix
pnpm fix           # lint:fixの別名
pnpm test          # Vitest
pnpm test:coverage # Vitest + カバレッジ
pnpm test:e2e      # ビルド + Playwright
pnpm fallow        # fallow（デッドコード / 循環依存 / 重複 / ヘルス / 境界）
pnpm fallow:audit  # origin/main 基準の差分監査（新規のみ）
pnpm mutation      # ミューテーションテスト（全件。レポートは .mutator/report）
pnpm mutation:diff # origin/main との共通の祖先で基準を作り、差分と変更したテストの分を実行して、テストを弱めた変更なら失敗
pnpm test:mutation-guard # 一時的なリポジトリで、テストを消すとmutation:diffが失敗することを確かめる
pnpm mutation:findings # 直前の結果からテストを弱めた変更を判定（基準のrefを渡すと設定の変更も警告）
pnpm check         # lint + typecheck + test + fallow + mutation:diff
pnpm check:all     # check + coverage + build + e2e + dedupe
pnpm clean         # 生成物（.output / .wxt / coverage 等）を削除
pnpm dedupe:check  # pnpm dedupe --check
pnpm run audit     # pnpm audit --audit-level moderate（CI では週1回）
pnpm settings:check # GitHub 設定のドリフト検出
pnpm settings:apply # GitHub 設定を適用
```

## Gitフック（lefthook）

- pre-commit / pre-pushは`lefthook.yml`で定義し、`prepare`（`pnpm install` → `lefthook install`）で
  インストールします。フックをスキップするには`LEFTHOOK=0`を設定します。
- `pre-commit`はstagedの対象ファイルに`biome check --write`と`rumdl check`（`*.md`）、
  日本語タイポグラフィの`--fix`（`*.{md,ts,tsx,js,yml,yaml,sh,html}`）を実行し、`pre-push`は
  `pnpm check`（lint + typecheck + test + fallow + mutation:diff）を実行します。

## CI（GitHub Actions）

`.github/workflows/ci.yml`が`push` / `pull_request`で`lint` / `fallow` /
`typecheck` / `test`（カバレッジ）/ `mutation` / `build` / `e2e` / `nix`を実行します。`lint`ジョブは
`pnpm lint`（`biome ci`）に加えて`pnpm dedupe:check`を実行し、`pnpm audit`は週1回の定期実行の
`audit`ジョブだけが実行します（PRで増える依存は`dependency-review`が検査します）。
`nix`ジョブは`nix flake check`とdevShellのrealizeの後に
`shellcheck scripts/*.sh && actionlint`を実行します。`mutation`ジョブは、PRで
`scripts/mutation-diff.sh`を実行し（基準はその場で作り、artifactは使わない）、全件のスコアを
ジョブの概要に出します。artifact（`coverage`、`chrome-mv3-unpacked` / `chrome-mv3-zip`、
失敗時だけ`playwright-test-results`（trace / screenshot）と`playwright-report`）は
Actions実行ページのArtifactsから取得できます。
`.github/workflows/verify-lockfile.yml`が`actions.lock`の整合性を検証します
（`ci.yml` / `codeql.yml` / `dependency-review.yml` / `verify-lockfile.yml`を含む）。
`.github/workflows/codeql.yml`が`javascript-typescript`と`actions`を解析し、
`.github/workflows/dependency-review.yml`が`pull_request`で依存をレビューします
（`fail-on-severity: moderate`）。
ローカルで同じ検証をする場合は上記スクリプトをそのまま実行してください。

- **Nixジョブ** はコミット済みの`flake.lock`を使います。`nixpkgs`は
  `nixos-26.05`の、ロック時点で7日以上経過したrevに固定しています
  （`flake.nix`の入力URLは`github:NixOS/nixpkgs/nixos-26.05`のまま）。
- **Dependabot**（`.github/dependabot.yml`）が毎週npm / github-actions / nixを更新。
  `@playwright/test`はnixpkgs `playwright-driver`（1.59.1）と整合が必要なため
  自動更新から除外しています。nixエコシステムはコミット済みの`flake.lock`を
  更新対象にします。
- **TypeScript 7**（`tsc`のみ。JS APIはmutatorの型判定だけが使う）。Vite 8 / WXTはTS APIを必要と
  しません。`vite@8.3.5`はWXTの必須peerとして直接devDependencyに追加。
- **サプライチェーン**: pnpmは`minimumReleaseAge: 10080` / installスクリプト
  ブロック（`onlyBuiltDependencies`）/ `trustPolicy: no-downgrade` /
  `blockExoticSubdeps: true`を`pnpm-workspace.yaml`に設定。CIは
  `pnpm install --frozen-lockfile`。GitHub Actionsの`uses:`は**可読な
  バージョンタグ**（例: `actions/checkout@v7.0.1`）で書き、実行時のpinは
  GAのワークフロー依存ロックファイル`.github/workflows/actions.lock`
  （`gh actions-lock`、GA 2026-10-28）に委ねます。最小権限（`contents: read`、
  artifactを上げるジョブのみ`actions: write`）、`actions/checkout`は
  `persist-credentials: false`。`pull_request_target`は使用しません。CodeQLジョブのみ`security-events: write`（と`packages: read`）を追加します。

### ワークフローのロックファイル（`actions.lock`）

`.github/workflows/`配下のワークフローを変更したら、**同じ変更の中で**
`.github/workflows/actions.lock`を作り直してください。lockfileは手編集禁止です。

```bash
gh extension install github/gh-actions-lock --pin v0.4.1
gh actions-lock                 # actions.lock を生成 / 更新
gh actions-lock --verify        # 検証（ネットワークが必要）
gh actions-lock --verify-local  # オフラインで検証
```

生成した`.github/workflows/actions.lock`はワークフローの変更と一緒にコミットします。
`codeql.yml`や`dependency-review.yml`を変えたときも同様です。

リポジトリ設定（Dependabot alerts、secret scanning / push protection、private
vulnerability reporting、`main`のルールセット）はREADMEのチェックリストと
`SECURITY.md`を参照してください。セキュリティ設定と`main`ルールセットは
`scripts/github-settings.sh`（`--check` / `--apply`）と`.github/settings/*.json`
でも管理します。ただしActionsの "Require lockfile" はAPI非対応のため
Settings UIで設定してください。

### 7日ポリシー

公開直後のサプライチェーン攻撃を避けるため、バージョン更新は7日待ちます。

- pnpm: `minimumReleaseAge: 10080`（分）。`minimumReleaseAgeExclude`やtrust-policyの除外は
  文章で禁止するだけでなく`pnpm lint:pnpm-policy`が拒否する。7日未満の最新安定版は、
  十分に古くなった安定版へピンする
- Dependabot: `cooldown.default-days: 7`（**バージョン更新のみ**。セキュリティ
  更新はcooldownの対象外で、追加キーは不要）

### その他のツール

- 大きな変更では任意で`gh stack`（`gh extension install github/gh-stack`）を
  使えますが、必須ではありません。
- Issue artifact（`gh issue artifact`）は **preview** です。必須にしないでください。
- `.github/agents/`や2つ目の長い`.github/copilot-instructions.md`は追加しないでください。

## 依存とバージョン

- **安定版のみ**。alpha / beta / RC / experimentalは禁止。
- Playwrightは **nixpkgsの`playwright-driver`とsemverを一致**させる
  （現在: `@playwright/test@1.59.1` ↔ nixpkgs `nixos-26.05`）。
  どちらかを上げる場合は両方を同時に更新する。
- `effect`は安定4.xのみ。`@effect/*`のunstableモジュールは使わない。

## MV3 Service Workerのルール

- `chrome.runtime.onMessage`などのリスナーは **モジュールのトップレベルで同期的に登録**する。
  `await`の後や非同期関数の中で登録してはいけない（SWが即座に停止される可能性がある）。
- **権威状態をSWのモジュール変数に持たない**。`chrome.storage`に永続化し、必要時に再読込する。
- 非同期レスポンスを返す場合はリスナーで`return true`を返し、チャネルを開いたままにする。

## コーディングスタイル

- Biome（format + lint）。`pnpm lint`を通すこと。
- TypeScript `strict`（`noUncheckedIndexedAccess`有効）。
- `verbatimModuleSyntax`有効。型importは`import type`を使う。
