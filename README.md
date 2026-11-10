# Chrome MV3 Extension Starter Template

WXT + Effect v4 + Nix による **Chrome MV3 拡張機能の雛形**です。  
Windows + WSL で開発し、Windows 側の Chrome に unpacked 拡張として読み込むワークフローを前提にしています。

- **WXT 0.21.5** — ビルド / 開発サーバ / manifest 生成
- **Effect 4.1.2** — ドメインロジック・依存注入（Functional Core / Imperative Shell）
- **TypeScript 7.0.2** — Go ネイティブの `tsc`（型チェック専用。TS JS API は不要）
- **Vitest 5** — `src/core` の純関数ユニットテスト（カバレッジは `@vitest/coverage-v8`）
- **Playwright 1.59.1** — ビルド済み拡張の E2E（nixpkgs `playwright-driver` と一致させるため固定）
- **Biome 2.6.4** — lint / format
- **fallow 3.38.1** — デッドコード / 循環依存 / 重複 / ヘルススコアの解析
- **lefthook 2.2.1** — Git フック（pre-commit / pre-push）
- **Nix flake** — Node 24 / pnpm / Playwright Chromium を固定
- **GitHub Actions CI** — lint / fallow / typecheck / test / build / e2e / nix / verify-lockfile / CodeQL / dependency-review

---

## 前提

- Windows + 汎用 **WSL ディストリビューション**（Ubuntu 等）
- [Nix](https://nixos.org/)（flakes 有効）+ [direnv](https://direnv.net/)
- `pnpm` は flake から供給されます（個別インストール不要）
- Windows 側に Google Chrome

> **重要: プロジェクトは WSL のホーム配下（`~/...`）に置いてください。**  
> `/mnt/c` 配下に置くと、ファイル I/O が遅く、WXT のファイル監視（HMR）が正しく動作しないことがあります。

---

## セットアップ

```bash
# WSL のホーム配下に clone
cd ~
git clone <this-repo> chrome-ext-template
cd chrome-ext-template

# Nix devShell に入る（flake.lock はコミット済み）
direnv allow            # または
nix develop

# 依存をインストール
pnpm install
```

### flake.lock について

`flake.lock` はコミット済みです。`flake.nix` の入力 URL は `github:NixOS/nixpkgs/nixos-26.05` のまま、lock だけを 7 日以上経過した `nixos-26.05` の rev に固定しています（現在: `0273948573ae398423980aa6739366d0350d999a`、committer date `2026-11-03T08:41:17Z`）。

rev を更新するときも URL は変えず、同じ方針で lock だけを差し替えます。

```bash
nix flake lock --override-input nixpkgs github:NixOS/nixpkgs/<sha>
```

---

## 開発

```bash
pnpm dev
```

- WXT は **ブラウザを自動起動しません**（`webExt.disabled` を設定済み）。  
  開発中の Chrome は Windows 側で手動で用意します。
- dev ビルドの出力先は `.output/chrome-mv3-dev` です。

### Windows Chrome に読み込む

1. WSL で `pnpm dev` を実行したままにする。
2. Windows の Chrome で `chrome://extensions` を開く。
3. 右上の **デベロッパーモード** を ON。
4. **パッケージ化されていない拡張機能を読み込む** をクリック。
5. 次のパスを指定する（エクスプローラのアドレスバーに貼り付け可）:

   ```
   \\wsl.localhost\<ディストロ名>\home\<user>\<repo>\.output\chrome-mv3-dev
   ```

   - 例: `\\wsl.localhost\Ubuntu\home\alice\chrome-ext-template\.output\chrome-mv3-dev`
   - `\\wsl$\...` でも可（古い Windows の場合）。
   - パスに **空白を入れない** でください（`\\wsl.localhost` 形式では特に）。

### デバッグ

- **Service Worker**: `chrome://extensions` → 対象拡張の **Service Worker** リンクから DevTools を開く。
- **ポップアップ**: 拡張アイコンを右クリック → **ポップアップを検証**。
- ログは Windows 側の DevTools コンソールに出ます。

### リロード

- コード変更後は **Alt+R** で拡張をリロードできます（WXT の拡張リロードショートカット）。
- `Alt+R` が効かない場合の手動リロード:
  1. `chrome://extensions` を開く
  2. 対象拡張の **再読み込み**（更新アイコン）をクリック
  3. ポップアップ / Service Worker の DevTools を開き直す

### フォールバック: Windows 側ディレクトリにコピーして読み込む

`\\wsl.localhost` 経由の読み込みがうまくいかない場合は、ビルド出力を Windows 側へコピーします。

```bash
# 例: Windows の C:\ext-dev\chrome-ext-template にコピー
pnpm build
cp -r .output/chrome-mv3 /mnt/c/ext-dev/chrome-ext-template
```

その後、Chrome の「パッケージ化されていない拡張機能を読み込む」で
`C:\ext-dev\chrome-ext-template`（`manifest.json` があるディレクトリ）を指定します。
`%LOCALAPPDATA%` 配下でも構いません。

---

## Playwright のバージョン整合

`@playwright/test` は **1.59.1 に固定**しています。  
これは nixpkgs `nixos-26.05` が提供する `playwright-driver` が **1.59.1** であることに合わせたものです。

- npm 側の最新（1.65.x 等）を使うと、Nix が供給するブラウザとバージョンがずれ、E2E が起動に失敗することがあります。
- **どちらかを上げる場合は必ず両方を同時に更新**してください（`flake.nix` の nixpkgs と `package.json` の `@playwright/test`）。

Nix devShell では次の環境変数が設定されます（`flake.nix` 参照）:

```
PLAYWRIGHT_BROWSERS_PATH=<nixpkgs の Chromium>
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
```

Nix 外でローカル検証する場合のみ `CHROME_PATH=/usr/bin/google-chrome-stable` などを指定できます。

---

## TypeScript 7

`typescript@7.0.2`（Go ネイティブコンパイラ）を使用しています。

- TS 7 は **型チェック専用** で、プログラム用 JS API を提供しません（JS API は 7.1 で予定、現在 beta のため未使用）。
- WXT 0.21.5 は `typescript` を peer として要求しますが、その JS は `typescript` を `import` しません（`wxt prepare` は型/tsconfig を生成するだけ）。Vite 8 は Oxc/rolldown でトランスパイルするため TS API も不要です。
- `vite@8.3.5` は WXT の必須 peer のため、直接 devDependency として追加しています（推移的にも解決済み）。
- `tsconfig.json` は `baseUrl` を設定しません（WXT 生成の `.wxt/tsconfig.json` が `paths` を持ちます）。TS 7 は CSS の副作用 import に厳しいため、`types` に `vite/client` を追加しています。

---

## CI（GitHub Actions）

`.github/workflows/ci.yml` が `push` / `pull_request` で以下を実行します（すべて `ubuntu-latest` / Node 24）。

| ジョブ               | 内容                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `lint`               | `pnpm lint`（Biome）                                                 |
| `fallow`             | `pnpm fallow`（デッドコード / 循環依存 / 重複 / ヘルス）。PR では `fallow audit --gate new-only` も実行 |
| `typecheck`          | `pnpm typecheck`（`wxt prepare && tsc --noEmit`）                    |
| `test`               | `pnpm test:coverage` → カバレッジ artifact `coverage`                |
| `build`              | `pnpm build` + `pnpm zip` → artifact `chrome-mv3-unpacked` / `chrome-mv3-zip` |
| `e2e`                | `pnpm exec playwright install --with-deps chromium` → `pnpm test:e2e`。失敗時のみ `test-results/` と HTML レポートを artifact 化 |
| `nix`                | `nix flake check` と `devShell` の realize（後述）                   |
| `verify-lockfile`    | `.github/workflows/actions.lock` を `gh actions-lock --verify` で検証（`verify-lockfile.yml`）。`ci.yml` / `codeql.yml` / `dependency-review.yml` / `verify-lockfile.yml` を対象にする |
| `CodeQL`             | `codeql.yml`。`javascript-typescript` と `actions` を解析（`main` への push/PR、および毎週） |
| `dependency-review`  | `dependency-review.yml`。`pull_request` で依存をレビューし、`fail-on-severity: moderate` |

- artifact は各ジョブの **Actions 実行ページ → Artifacts** からダウンロードできます。
- ローカルで同じ検証をするには:

  ```bash
  pnpm install --frozen-lockfile
  pnpm lint && pnpm fallow && pnpm typecheck && pnpm test:coverage
  pnpm build && pnpm zip
  pnpm exec playwright install --with-deps chromium   # 初回のみ
  pnpm test:e2e
  ```

- **Nix ジョブ** はコミット済みの `flake.lock` を使います。`nixpkgs` は `nixos-26.05` の、7 日以上経過した rev に固定されています。
- Playwright は **1.59.1 に固定** し、nixpkgs `playwright-driver` と一致させています（[Playwright のバージョン整合](#playwright-のバージョン整合) 参照）。
- **CodeQL**（`codeql.yml`）と **dependency review**（`dependency-review.yml`）もこのテンプレートに含まれます。ワークフローを変えたら `gh actions-lock` で lockfile を更新し、`verify-lockfile` で検証してください。

### ワークフローのロックファイル（`actions.lock`）

`uses:` は **可読なバージョンタグ**（例: `actions/checkout@v7.0.1`）で書きます。
実行時の pin は GA のワークフロー依存ロックファイル
`.github/workflows/actions.lock`（`gh actions-lock`、GA 2026-10-28）が担います。
lockfile は **手編集しないでください**。

`.github/workflows/` 配下のワークフローを変えたら、**同じ変更の中で**作り直します。

```bash
gh extension install github/gh-actions-lock --pin v0.4.1
gh actions-lock                 # actions.lock を生成 / 更新
gh actions-lock --verify        # 検証（ネットワークが必要）
gh actions-lock --verify-local  # オフラインで検証
```

#### One-time `actions.lock` 生成（まだファイルが無い場合）

```bash
gh extension install github/gh-actions-lock --pin v0.4.1
gh actions-lock
git add .github/workflows/actions.lock
```

ワークフローを変えたら同じコマンドで作り直し、その変更と一緒にコミットします。
lockfile は手編集しません。

### Dependabot

`.github/dependabot.yml` が毎週 `npm` / `github-actions` / `nix` の更新 PR を作成します（グループ化済み）。

- `@playwright/test` は nixpkgs `playwright-driver`（1.59.1 / `nixos-26.05`）と整合させる必要があるため、**Dependabot の自動更新から除外**しています。上げる場合は `flake.nix` の nixpkgs と `package.json` を同時に更新してください。
- `@types/node` は Node 24 ランタイムに合わせて **major 更新を無視**しています。
- `nix` エコシステムはコミット済みの `flake.lock` を更新対象にします。
- バージョン更新は `cooldown.default-days: 7` で 7 日待ちます（pnpm `minimumReleaseAge: 10080` と同じ方針）。セキュリティ更新は cooldown の対象外で、追加のキーは不要です（公式挙動）。

---

## fallow（デッドコード / 循環依存 / 重複 / ヘルス）

[fallow](https://fallow.tools/) で未使用エクスポート、循環依存、重複、ヘルススコアを検査します。

```bash
pnpm fallow          # dead-code + architecture --cycles + dupes + health
pnpm fallow:audit    # origin/main 基準の差分監査（新規の問題のみ）
```

- 設定は [`.fallowrc.json`](./.fallowrc.json)。`unused-dev-dependencies` と
  `circular-dependencies` を `error` にしています。
- `entry` は指定しません。WXT プラグインがエントリポイントを自動検出します。
- `fallow` は **3.38.1 に固定**しています。7 日ポリシーにより、
  `>=3.42.0`（`GHSA-rg8g-qqf6-7q69` と `GHSA-h858-c8f4-h92c`、いずれも Low を修正）へは
  **2026-11-17 16:28 JST 以降**に上げてください。

## lefthook（Git フック）

[lefthook](https://lefthook.dev/) で pre-commit / pre-push フックを管理します。

- フックは `prepare` スクリプト（`pnpm install` → `lefthook install`）でインストールされます。
- フックをスキップするには `LEFTHOOK=0` を設定します（例: `LEFTHOOK=0 git commit ...`）。
- `pre-commit` は staged の対象ファイルに `biome check --write` を実行し、修正を stage します。
- `pre-push` は `fallow audit --base origin/main --quiet` を実行します（`origin/main` が無い場合はスキップ）。
- 設定は [`lefthook.yml`](./lefthook.yml)。
- `lefthook` は `2.2.1` に固定しています。npm provenance を持ち、かつ 7 日ポリシーを満たす後続リリースが出るまでは `2.2.1` のままにします（その条件を満たした時点で上げます）。

---

## サプライチェーン / セキュリティ

- **pnpm 設定**（`pnpm-workspace.yaml`）:
  - `minimumReleaseAge: 10080`（7 日）— 公開から 7 日未満のパッケージはインストールしない。`minimumReleaseAgeExclude` は使わない。直接依存は、その時点で 7 日以上経過した最新の安定版にピンする（例: `effect@4.1.2`、`@biomejs/biome@2.6.4`、`vite@8.3.5`）。
  - `onlyBuiltDependencies: []` — install スクリプトは既定でブロック。lefthook の postinstall は無視して問題ありません（バイナリは optionalDependencies から入り、フックは `prepare` で入れます）。
  - `trustPolicy: no-downgrade` / `blockExoticSubdeps: true`。
  - 常に `pnpm-lock.yaml` をコミットし、CI は `pnpm install --frozen-lockfile` を使用。
- **GitHub Actions**:
  - `uses:` は**可読なバージョンタグ**（例: `actions/checkout@v7.0.1`）で書き、実行時の pin は GA のワークフロー依存ロックファイル `.github/workflows/actions.lock`（`gh actions-lock`）で管理。lockfile は手編集しない。
  - 権限は最小（`contents: read`、artifact を上げるジョブのみ `actions: write`）。`actions/checkout` は `persist-credentials: false`。
  - `pull_request_target` は使用しません。CodeQL ジョブだけ `security-events: write`（と packs 取得用の `packages: read`）を付与します。dependency review は `contents: read` のみです。

---

## リポジトリ設定チェックリスト

以下はファイルでは設定できません。リポジトリの Settings から手動で行ってください。脆弱性の報告方法は [`SECURITY.md`](./SECURITY.md) を参照してください。

一部の設定は `scripts/github-settings.sh` でコード化しています（後述）。

1. **Settings → Advanced Security**: Dependabot alerts、Dependabot security updates、Dependabot malware alerts をオンにする。
2. **Secret scanning** と **push protection** をオンにする（公開リポジトリでは利用できます）。
3. **Private vulnerability reporting** をオンにする（手順は [`SECURITY.md`](./SECURITY.md)）。
4. **`.github/workflows/actions.lock` をコミットし、`verify-lockfile` ジョブが通ってから** Settings → Actions → Policies で **Require lockfile** を Active にする。lockfile が無い状態で Active にするとワークフローが止まります。Free プランに Evaluate モードはありません。
5. **`main` のブランチルールセット**（Settings → Rules → Rulesets）: 直接 push を禁止し、PR を必須にする。必須ステータスに `lint` / `fallow` / `typecheck` / `test` / `build` / `e2e` / `nix` / `verify-lockfile` / CodeQL / dependency-review を含める。force push を禁止する。
6. 拡張を **GitHub Releases** で配るときに **immutable releases** をオンにする。

---

## リポジトリ設定のコード化（`scripts/github-settings.sh`）

セキュリティ設定と `main` のルールセットを JSON として管理します。

```bash
./scripts/github-settings.sh --check   # 読み取り専用でドリフトを検出（既定）
./scripts/github-settings.sh --apply   # 望ましい状態を書き込む
```

- リポジトリは `--repo OWNER/REPO` か第 1 引数、省略時は `gh repo view` から取得します。
- 望ましい状態は [`.github/settings/security.json`](./.github/settings/security.json) と
  [`.github/settings/ruleset-main.json`](./.github/settings/ruleset-main.json)。
- `--check` は書き込みません。ドリフトがあると非 0 で終了します。
- **Actions の "Require lockfile" は API では設定できません**（[github/rest-api-description#7366](https://github.com/github/rest-api-description/issues/7366)）。
  Settings → Actions → Policies の UI から手動で設定してください。スクリプトはこの項目を扱いません。
- 依存には `gh` と `jq` が必要です。

---

## 主なスクリプト

| スクリプト        | 内容                               |
| ----------------- | ---------------------------------- |
| `pnpm dev`        | 開発サーバ（ブラウザ自動起動なし） |
| `pnpm build`      | 本番ビルド（`.output/chrome-mv3`） |
| `pnpm zip`        | 配布用 zip を作成                  |
| `pnpm typecheck`  | `wxt prepare` + `tsc --noEmit`     |
| `pnpm lint`       | Biome でチェック                   |
| `pnpm lint:fix`   | Biome で自動修正                   |
| `pnpm test`       | Vitest ユニットテスト              |
| `pnpm test:coverage` | Vitest + カバレッジ（text/lcov/html → `coverage/`） |
| `pnpm test:watch` | Vitest ウォッチ                    |
| `pnpm test:e2e`   | ビルド + Playwright E2E            |
| `pnpm fallow`     | fallow でデッドコード / 循環依存 / 重複 / ヘルスを解析 |
| `pnpm fallow:audit` | `origin/main` を基準にした fallow 監査（新規のみ） |

---

## ディレクトリ構成

```
src/
  entrypoints/        # 薄い Imperative Shell（WXT エントリポイント）
    background.ts     # MV3 Service Worker
    popup/            # ポップアップ UI
    content.ts        # 最小スタブ（matches は必要になるまで狭く保つ）
  core/               # 純粋ドメイン（chrome 禁止・I/O 禁止）
  services/           # Effect Context タグ（インターフェースのみ）+ ユースケース
  layers/             # Live（chrome.*）実装 / Test（インメモリ）実装
e2e/                  # Playwright E2E（スモーク + URL 保存フロー）
.github/              # GitHub Actions CI / Dependabot
```

### レイヤーの向き（依存の方向）

```
entrypoints  →  layers / services  →  core
```

- `src/core` は **`chrome.*` / WXT / layers を import してはいけません**（純関数のみ）。
- 境界データ（メッセージ、`chrome.storage`、タブ URL）は必ず **Effect Schema で decode** します。
- 詳細な規約は [`AGENTS.md`](./AGENTS.md) を参照してください。

---

## サンプル機能

ポップアップの **「現在のタブの URL を保存」** ボタン:

1. ポップアップ → `chrome.runtime.sendMessage` で background に要求
2. background（Service Worker）が現在のタブ URL を取得し、検証・重複排除
3. `chrome.storage.local` に永続化
4. ポップアップが保存済み URL 一覧を再表示

状態は必ず `chrome.storage` に永続化され、Service Worker が停止しても失われません。
