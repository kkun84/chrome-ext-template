# Chrome MV3 Extension Starter Template

WXT + Effect v4 + Nix による **Chrome MV3 拡張機能の雛形**です。  
Windows + WSL で開発し、Windows 側の Chrome に unpacked 拡張として読み込むワークフローを前提にしています。

- **WXT 0.21.5** — ビルド / 開発サーバ / manifest 生成
- **Effect 4.1.3** — ドメインロジック・依存注入（Functional Core / Imperative Shell）
- **Vitest 5** — `src/core` の純関数ユニットテスト
- **Playwright 1.59.1** — ビルド済み拡張の E2E スモーク
- **Biome 2.6.6** — lint / format
- **Nix flake** — Node 24 / pnpm / Playwright Chromium を固定

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

# Nix devShell に入る（初回は flake.lock の生成が必要）
direnv allow            # または
nix develop

# 依存をインストール
pnpm install
```

### flake.lock について

このリポジトリには **`flake.lock` を含めていません**。Nix がインストールされたマシンで、初回に次のいずれかを実行して生成してください。

```bash
nix flake lock          # flake.lock を生成
# または
direnv allow            # .envrc 経由で自動的にロック
```

生成された `flake.lock` はコミットして構いません。

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
| `pnpm test:watch` | Vitest ウォッチ                    |
| `pnpm test:e2e`   | ビルド + Playwright E2E            |

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
e2e/                  # Playwright スモーク
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
