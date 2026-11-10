# AGENTS.md — AI エージェント向け実装規約

このリポジトリは Chrome MV3 拡張の雛形です。以下を守って実装してください。

## レイヤーと依存の方向

```
entrypoints  →  layers / services  →  core
```

- **`src/core` は純粋**。`chrome.*`、WXT の `browser`、`src/layers`、`src/services` を
  import してはいけない。I/O・グローバル状態・`Date.now()` 以外の副作用を持たない
  （時刻は引数で受け取る）。
- `src/services` は **Effect `Context.Service` のタグ（インターフェース）と
  ユースケース関数のみ**。実装を置かない。
- `src/layers` に **Live（`chrome.*`）実装** と **Test（インメモリ）実装** を置く。
- `entrypoints` は **薄い Imperative Shell**。ロジックを書かず、ユースケースを呼ぶだけ。

## 新機能の置き場所

1. **domain** — `src/core` に純関数と Schema を追加し、Vitest でテストする。
2. **service tag** — `src/services/services.ts` に必要な `Context.Service` を追加。
3. **layer** — `src/layers` に Live 実装と Test 実装を追加。
4. **entrypoint** — `src/entrypoints` からユースケースを呼ぶだけの薄いコード。

## 型 / Schema 規約

- 名前的型は `Schema.brand` を使う（例: `SavedUrl`）。
- メッセージ・UI 状態は `Schema.TaggedClass` / 判別可能なユニオンで表現する。
- 分岐は **網羅的に**（`Match.tagsExhaustive` など）。暗黙のフォールスルー禁止。
- **境界データは必ず Schema で decode** する:
  - `chrome.runtime.onMessage` のメッセージ
  - `chrome.storage` のペイロード
  - `chrome.tabs` から得た URL 文字列
- 不正データは **投げずに型付きエラー**（`Schema.TaggedError`）または安全な既定値にする。

## テスト方針

- **`src/core`** は Vitest の純関数ユニットテスト（I/O なし）。
- **ユースケース** は `src/layers` の Test レイヤーを `Effect.provide` して検証する。
- **E2E** はビルド済み拡張を `--load-extension` で読み込み、Service Worker と
  ポップアップが到達可能であることを確認する（Playwright 1.59 の公式パターン）。

## よく使うコマンド

```bash
pnpm dev          # 開発（ブラウザ自動起動なし）
pnpm build        # 本番ビルド
pnpm typecheck    # wxt prepare + tsc
pnpm lint         # Biome
pnpm lint:fix     # Biome 自動修正
pnpm test         # Vitest
pnpm test:coverage # Vitest + カバレッジ
pnpm test:e2e     # ビルド + Playwright
pnpm fallow       # fallow（デッドコード / 循環依存 / 重複 / ヘルス）
pnpm fallow:audit # origin/main 基準の差分監査（新規のみ）
```

## Git フック（lefthook）

- pre-commit / pre-push は `lefthook.yml` で定義し、`prepare`（`pnpm install` → `lefthook install`）で
  インストールします。フックをスキップするには `LEFTHOOK=0` を設定します。
- `pre-commit` は staged の対象ファイルに `biome check --write`、`pre-push` は
  `fallow audit --base origin/main --quiet` を実行します。
- `fallow` は `3.38.1` に固定（7 日ポリシー）。`>=3.42.0` へは 2026-11-17 16:28 JST 以降に上げる。

## CI（GitHub Actions）

`.github/workflows/ci.yml` が `push` / `pull_request` で `lint` / `fallow` /
`typecheck` / `test`（カバレッジ）/ `build` / `e2e` / `nix` を実行します。artifact
（カバレッジ・拡張の unpacked/zip・失敗時の Playwright trace/screenshot）は
Actions 実行ページの Artifacts から取得できます。
`.github/workflows/verify-lockfile.yml` が `actions.lock` の整合性を検証します
（`ci.yml` / `codeql.yml` / `dependency-review.yml` / `verify-lockfile.yml` を含む）。
`.github/workflows/codeql.yml` が `javascript-typescript` と `actions` を解析し、
`.github/workflows/dependency-review.yml` が `pull_request` で依存をレビューします
（`fail-on-severity: moderate`）。
ローカルで同じ検証をする場合は上記スクリプトをそのまま実行してください。

- **Nix ジョブ** はコミット済みの `flake.lock` を使います。`nixpkgs` は
  `nixos-26.05` の、ロック時点で 7 日以上経過した rev に固定しています
  （`flake.nix` の入力 URL は `github:NixOS/nixpkgs/nixos-26.05` のまま）。
- **Dependabot**（`.github/dependabot.yml`）が毎週 npm / github-actions / nix を更新。
  `@playwright/test` は nixpkgs `playwright-driver`（1.59.1）と整合が必要なため
  自動更新から除外しています。nix エコシステムはコミット済みの `flake.lock` を
  更新対象にします。
- **TypeScript 7**（`tsc` のみ、JS API 不使用）。Vite 8 / WXT は TS API を必要と
  しません。`vite@8.3.5` は WXT の必須 peer として直接 devDependency に追加。
- **サプライチェーン**: pnpm は `minimumReleaseAge: 10080` / install スクリプト
  ブロック（`onlyBuiltDependencies`）/ `trustPolicy: no-downgrade` /
  `blockExoticSubdeps: true` を `pnpm-workspace.yaml` に設定。CI は
  `pnpm install --frozen-lockfile`。GitHub Actions の `uses:` は**可読な
  バージョンタグ**（例: `actions/checkout@v7.0.1`）で書き、実行時の pin は
  GA のワークフロー依存ロックファイル `.github/workflows/actions.lock`
  （`gh actions-lock`、GA 2026-10-28）に委ねます。最小権限（`contents: read`、
  artifact を上げるジョブのみ `actions: write`）、`actions/checkout` は
  `persist-credentials: false`。`pull_request_target` は使用しません。CodeQL ジョブのみ `security-events: write`（と `packages: read`）を追加します。

### ワークフローのロックファイル（`actions.lock`）

`.github/workflows/` 配下のワークフローを変更したら、**同じ変更の中で**
`.github/workflows/actions.lock` を作り直してください。lockfile は手編集禁止です。

```bash
gh extension install github/gh-actions-lock --pin v0.4.1
gh actions-lock                 # actions.lock を生成 / 更新
gh actions-lock --verify        # 検証（ネットワークが必要）
gh actions-lock --verify-local  # オフラインで検証
```

生成した `.github/workflows/actions.lock` はワークフローの変更と一緒にコミットします。
`codeql.yml` や `dependency-review.yml` を変えたときも同様です。

リポジトリ設定（Dependabot alerts、secret scanning / push protection、private
vulnerability reporting、`main` のルールセット）は README のチェックリストと
`SECURITY.md` を参照してください。セキュリティ設定と `main` ルールセットは
`scripts/github-settings.sh`（`--check` / `--apply`）と `.github/settings/*.json`
でも管理します。ただし Actions の "Require lockfile" は API 非対応のため
Settings UI で設定してください。

### 7 日ポリシー

公開直後のサプライチェーン攻撃を避けるため、バージョン更新は 7 日待ちます。

- pnpm: `minimumReleaseAge: 10080`（分）。`minimumReleaseAgeExclude` は使わない。7 日未満の最新安定版は、十分に古くなった安定版へピンする
- Dependabot: `cooldown.default-days: 7`（**バージョン更新のみ**。セキュリティ
  更新は cooldown の対象外で、追加キーは不要）

### その他のツール

- 大きな変更では任意で `gh stack`（`gh extension install github/gh-stack`）を
  使えますが、必須ではありません。
- Issue artifact（`gh issue artifact`）は **preview** です。必須にしないでください。
- `.github/agents/` や 2 つ目の長い `.github/copilot-instructions.md` は追加しないでください。

## 依存とバージョン

- **安定版のみ**。alpha / beta / RC / experimental は禁止。
- Playwright は **nixpkgs の `playwright-driver` と semver を一致**させる
  （現在: `@playwright/test@1.59.1` ↔ nixpkgs `nixos-26.05`）。
  どちらかを上げる場合は両方を同時に更新する。
- `effect` は安定 4.x のみ。`@effect/*` の unstable モジュールは使わない。

## MV3 Service Worker のルール

- `chrome.runtime.onMessage` などのリスナーは **モジュールのトップレベルで同期的に登録**する。
  `await` の後や非同期関数の中で登録してはいけない（SW が即座に停止される可能性がある）。
- **権威状態を SW のモジュール変数に持たない**。`chrome.storage` に永続化し、必要時に再読込する。
- 非同期レスポンスを返す場合はリスナーで `return true` を返し、チャネルを開いたままにする。

## コーディングスタイル

- Biome（format + lint）。`pnpm lint` を通すこと。
- TypeScript `strict`（`noUncheckedIndexedAccess` 有効）。
- `verbatimModuleSyntax` 有効。型 import は `import type` を使う。
