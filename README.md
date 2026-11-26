# Chrome MV3 Extension Starter Template

WXT + Effect v4 + Nixによる **Chrome MV3拡張機能の雛形**です。  
Windows + WSLで開発し、Windows側のChromeにunpacked拡張として読み込むワークフローを前提にしています。

- **WXT 0.21.5** — ビルド / 開発サーバ / manifest生成
- **Effect 4.1.2** — ドメインロジック・依存注入（Functional Core / Imperative Shell）
- **TypeScript 7.0.2** — Goネイティブの`tsc`（型チェック専用。ビルドと検査はTS JS APIを使わない。mutatorだけが型エラーになるミュータントの判定に`typescript/unstable/sync`を使う）
- **Vitest 5** — `src/core`の純関数ユニットテスト（カバレッジは`@vitest/coverage-v8`）
- **Playwright 1.59.1** — ビルド済み拡張のE2E（nixpkgs `playwright-driver`と一致させるため固定）
- **mutator 0.4.5** — ミューテーションテスト（CIは全件、`pnpm check`は差分だけ実行。テストを弱めた変更は失敗にする）
- **Biome 2.6.4** — lint / format（`pnpm lint` = `biome ci`、assistでimport整理）
- **rumdl 0.3.2** — Markdownのlint（`pnpm lint:md`、日本語ドキュメントのため`MD013`のみ無効）
- **fallow 3.42.0** — デッドコード / 循環依存 / 重複 / ヘルススコア / アーキテクチャ境界の解析
- **lefthook 2.2.1** — Gitフック（pre-commit / pre-push）
- **Nix flake** — Node 24 / pnpm / Playwright Chromium / shellcheck / actionlintを固定
- **GitHub Actions CI** — lint / fallow / typecheck / test / mutation / build / e2e / nix / verify-lockfile / CodeQL / dependency-review

---

## 前提

- Windows + 汎用 **WSLディストリビューション**（Ubuntu等）
- [Nix](https://nixos.org/)（flakes有効）+ [direnv](https://direnv.net/)
- `pnpm`はflakeから供給されます（個別インストール不要）
- Windows側にGoogle Chrome

> **重要: プロジェクトはWSLのホーム配下（`~/...`）に置いてください。**  
> `/mnt/c`配下に置くと、ファイルI/Oが遅く、WXTのファイル監視（HMR）が正しく動作しないことがあります。

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

### flake.lockについて

`flake.lock`はコミット済みです。`flake.nix`の入力URLは`github:NixOS/nixpkgs/nixos-26.05`のまま、lockだけを7日以上経過した`nixos-26.05`のrevに固定しています（現在: `0273948573ae398423980aa6739366d0350d999a`、committer date `2026-11-03T08:41:17Z`）。

revを更新するときもURLは変えず、同じ方針でlockだけを差し替えます。

```bash
nix flake lock --override-input nixpkgs github:NixOS/nixpkgs/<sha>
```

---

## 開発

```bash
pnpm dev
```

- WXTは **ブラウザを自動起動しません**（`webExt.disabled`を設定済み）。  
  開発中のChromeはWindows側で手動で用意します。
- devビルドの出力先は`.output/chrome-mv3-dev`です。

### Windows Chromeに読み込む

1. WSLで`pnpm dev`を実行したままにする。
2. WindowsのChromeで`chrome://extensions`を開く。
3. 右上の **デベロッパーモード** をON。
4. **パッケージ化されていない拡張機能を読み込む** をクリック。
5. 次のパスを指定する（エクスプローラのアドレスバーに貼り付け可）:

   ```text
   \\wsl.localhost\<ディストロ名>\home\<user>\<repo>\.output\chrome-mv3-dev
   ```

   - 例: `\\wsl.localhost\Ubuntu\home\alice\chrome-ext-template\.output\chrome-mv3-dev`
   - `\\wsl$\...`でも可（古いWindowsの場合）。
   - パスに **空白を入れない** でください（`\\wsl.localhost`形式では特に）。

### デバッグ

- **Service Worker**: `chrome://extensions` → 対象拡張の **Service Worker** リンクからDevToolsを開く。
- **ポップアップ**: 拡張アイコンを右クリック → **ポップアップを検証**。
- ログはWindows側のDevToolsコンソールに出ます。

### リロード

- コード変更後は **Alt+R** で拡張をリロードできます（WXTの拡張リロードショートカット）。
- `Alt+R`が効かない場合の手動リロード:
  1. `chrome://extensions`を開く
  2. 対象拡張の **再読み込み**（更新アイコン）をクリック
  3. ポップアップ / Service WorkerのDevToolsを開き直す

### フォールバック: Windows側ディレクトリにコピーして読み込む

`\\wsl.localhost`経由の読み込みがうまくいかない場合は、ビルド出力をWindows側へコピーします。

```bash
# 例: Windows の C:\ext-dev\chrome-ext-template にコピー
pnpm build
cp -r .output/chrome-mv3 /mnt/c/ext-dev/chrome-ext-template
```

その後、Chromeの「パッケージ化されていない拡張機能を読み込む」で
`C:\ext-dev\chrome-ext-template`（`manifest.json`があるディレクトリ）を指定します。
`%LOCALAPPDATA%`配下でも構いません。

---

## Playwrightのバージョン整合

`@playwright/test`は **1.59.1に固定**しています。  
これはnixpkgs `nixos-26.05`が提供する`playwright-driver`が **1.59.1** であることに合わせたものです。

- npm側の最新（1.65.x等）を使うと、Nixが供給するブラウザとバージョンがずれ、E2Eが起動に失敗することがあります。
- **どちらかを上げる場合は必ず両方を同時に更新**してください（`flake.nix`のnixpkgsと`package.json`の`@playwright/test`）。

Nix devShellでは次の環境変数が設定されます（`flake.nix`参照）:

```text
PLAYWRIGHT_BROWSERS_PATH=<nixpkgs の Chromium>
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
```

Nix外でローカル検証する場合のみ`CHROME_PATH=/usr/bin/google-chrome-stable`などを指定できます。

---

## TypeScript 7

`typescript@7.0.2`（Goネイティブコンパイラ）を使用しています。

- TS 7は **型チェック専用** で、プログラム用JS APIを提供しません（JS APIは7.1で予定、現在betaのため未使用）。例外はmutatorで、型エラーになるミュータントの判定に`typescript/unstable/sync`を使います。
- WXT 0.21.5は`typescript`をpeerとして要求しますが、そのJSは`typescript`を`import`しません（`wxt prepare`は型/tsconfigを生成するだけ）。Vite 8はOxc/rolldownでトランスパイルするためTS APIも不要です。
- `vite@8.3.5`はWXTの必須peerのため、直接devDependencyとして追加しています（推移的にも解決済み）。
- `tsconfig.json`は`baseUrl`を設定しません（WXT生成の`.wxt/tsconfig.json`が`paths`を持ちます）。TS 7はCSSの副作用importに厳しいため、`types`に`vite/client`を追加しています。

---

## CI（GitHub Actions）

`.github/workflows/ci.yml`が`push` / `pull_request`で以下を実行します（`e2e`のみ`ubuntu-24.04`、他は`ubuntu-latest` / Node 24）。`e2e`を`ubuntu-24.04`に固定するのは、Playwright 1.59.1がUbuntu 26.04をサポートしないためです。

| ジョブ               | 内容                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `lint`               | `pnpm lint`（`biome ci` + `rumdl check` + ja-space + pnpm-policy + no-suppress）。続けて`pnpm dedupe:check`を実行 |
| `audit (weekly)`     | `pnpm run audit`。週1回の定期実行のときだけ動く（PRでは動かない） |
| `mutation`           | ミューテーションテスト。PRでは、ベースブランチとの共通の祖先で全件を実行した結果を基準にして、テストを弱めた変更なら失敗する。変更した行の検出漏れと、何も検出しない新しいテストは警告にする。全件のスコアをジョブの概要（Summary）に出す |
| `fallow`             | `pnpm fallow`（デッドコード / 循環依存 / 重複 / ヘルス / 境界）。PRでは`fallow audit --gate new-only`も実行 |
| `typecheck`          | `pnpm typecheck`（`wxt prepare && tsc --noEmit`）                    |
| `test`               | `pnpm test:coverage` → カバレッジartifact `coverage`                |
| `build`              | `pnpm build` + `pnpm zip` → artifact `chrome-mv3-unpacked` / `chrome-mv3-zip` |
| `e2e`                | `pnpm exec playwright install --with-deps chromium` → `pnpm test:e2e`。失敗時のみ`test-results/`とHTMLレポートをartifact化 |
| `nix`                | `nix flake check`と`devShell`のrealize、`shellcheck scripts/*.sh && actionlint`（後述） |
| `verify-lockfile`    | `.github/workflows/actions.lock`を`gh actions-lock --verify`で検証（`verify-lockfile.yml`）。`ci.yml` / `codeql.yml` / `dependency-review.yml` / `verify-lockfile.yml`を対象にする |
| `CodeQL`             | `codeql.yml`。`javascript-typescript`と`actions`を解析（`main`へのpush/PR、および毎週） |
| `dependency-review`  | `dependency-review.yml`。`pull_request`で依存をレビューし、`fail-on-severity: moderate` |

- artifactは各ジョブの **Actions実行ページ → Artifacts** からダウンロードできます。
- ローカルで同じ検証をするには:

  ```bash
  pnpm install --frozen-lockfile
  pnpm check          # lint + typecheck + test + fallow + mutation:diff
  pnpm test:coverage
  pnpm build && pnpm zip
  pnpm exec playwright install --with-deps chromium   # 初回のみ
  pnpm test:e2e
  ```

  まとめて実行する場合は`pnpm check:all`（`check` + `test:coverage` + `build` +
  `test:e2e` + `dedupe:check`）を使います。
- **Nixジョブ** はコミット済みの`flake.lock`を使います。`nixpkgs`は
  `nixos-26.05`の、7日以上経過したrevに固定されています。devShellには
  `shellcheck`と`actionlint`が入っており、CIの`nix`ジョブが
  `nix develop --command sh -c 'shellcheck scripts/*.sh && actionlint'`を実行します。
- Playwrightは **1.59.1に固定** し、nixpkgs `playwright-driver`と一致させています（[Playwrightのバージョン整合](#playwrightのバージョン整合) 参照）。
- **CodeQL**（`codeql.yml`）と **dependency review**（`dependency-review.yml`）もこのテンプレートに含まれます。ワークフローを変えたら`gh actions-lock`でlockfileを更新し、`verify-lockfile`で検証してください。

### ワークフローのロックファイル（`actions.lock`）

`uses:`は **可読なバージョンタグ**（例: `actions/checkout@v7.0.1`）で書きます。
実行時のpinはGAのワークフロー依存ロックファイル
`.github/workflows/actions.lock`（`gh actions-lock`、GA 2026-10-28）が担います。
lockfileは **手編集しないでください**。

`.github/workflows/`配下のワークフローを変えたら、**同じ変更の中で**作り直します。

```bash
gh extension install github/gh-actions-lock --pin v0.4.1
gh actions-lock                 # actions.lock を生成 / 更新
gh actions-lock --verify        # 検証（ネットワークが必要）
gh actions-lock --verify-local  # オフラインで検証
```

#### One-time `actions.lock`生成（まだファイルが無い場合）

```bash
gh extension install github/gh-actions-lock --pin v0.4.1
gh actions-lock
git add .github/workflows/actions.lock
```

ワークフローを変えたら同じコマンドで作り直し、その変更と一緒にコミットします。
lockfileは手編集しません。

### Dependabot

`.github/dependabot.yml`が毎週`npm` / `github-actions` / `nix`の更新PRを作成します（グループ化済み）。

- `@playwright/test`はnixpkgs `playwright-driver`（1.59.1 / `nixos-26.05`）と整合させる必要があるため、**Dependabotの自動更新から除外**しています。上げる場合は`flake.nix`のnixpkgsと`package.json`を同時に更新してください。
- `@types/node`はNode 24ランタイムに合わせて **major更新を無視**しています。
- `nix`エコシステムはコミット済みの`flake.lock`を更新対象にします。
- バージョン更新は`cooldown.default-days: 7`で7日待ちます（pnpm `minimumReleaseAge: 10080`と同じ方針）。セキュリティ更新はcooldownの対象外で、追加のキーは不要です（公式挙動）。

---

## fallow（デッドコード / 循環依存 / 重複 / ヘルス / 境界）

[fallow](https://fallow.tools/) で未使用エクスポート、循環依存、重複、ヘルススコア、
**アーキテクチャ境界**を検査します。

```bash
pnpm fallow          # dead-code + architecture（cycles / boundaries / policy）+ dupes + health
pnpm fallow:audit    # origin/main 基準の差分監査（新規の問題のみ）
```

- 設定は [`.fallowrc.json`](./.fallowrc.json)。`unused-dev-dependencies` /
  `circular-dependencies` / `boundary-violation`を`error`にしています。
- `boundaries`でレイヤー方向（`entrypoints → layers / services → core`）を強制します。
  `src/core`ゾーンでは`Date.now` / `Math.random` / `chrome.*` / `browser.*` /
  `globalThis.chrome`の呼び出しも禁止します。
- `entry`は指定しません。WXTプラグインがエントリポイントを自動検出します。
- `ignoreExports`で、`src/services/messages.ts`の4つのexportを`duplicate-exports`の対象から
  外しています。この設定は未使用exportの検出からも外すので、この4つは使われなくなっても検出されません。entrypointsが`src/core`を直接importしないよう、`src/core/messages.ts`と同じ名前で
  再エクスポートしているためです。

## mutator（ミューテーションテスト）

[@mizchi/mutator](https://github.com/mizchi/mutator) で、テストが実装の変更を検出できるかを確かめます。
対象は`mutator.config.json`の`include`（`src/core`と`src/services`）です。

```bash
pnpm mutation          # 全件を実行。レポートは .mutator/report/index.html
pnpm mutation:diff     # origin/main との共通の祖先で基準を作り、差分と変更したテストが確かめるコードのミュータントを実行して判定
pnpm mutation:findings # 直前の結果（.mutator/report/mutation.json）から、テストを弱めた変更を判定
```

失敗にするのは、テストを弱めた変更です。変わっていないコードのミュータントを、基準ではテストが
検出していたのに、今はどのテストも検出しない場合を指します（mutatorの`detectionRegression`）。
アサーションを弱めたり、テストを消したりした変更がこれに当たります。

- 何も検出しない新しいテスト（`newTestNoKills`）と、検出できないミュータント（生き残りと、どのテストも
  届かないもの）は警告にします。全件のスコアは表示だけです。
- テストが元々落ちている場合も失敗します。

テストを弱めた変更と判定されたら、弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめる
テストを足します。`mutator accept`で通してはいけません。`mutator.accepted.json`は等価ミュータント専用です。

### 比べる基準の作り方

`pnpm mutation:diff`（`scripts/mutation-diff.sh`）は、前回の実行結果を使わず、毎回その場で基準を作ります。

1. `git merge-base origin/main HEAD`のコミットを、一時ディレクトリに`git worktree add --detach`で取り出す。
2. そこへ今の作業ツリーの`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.npmrc`、
   `tsconfig*.json`、`vitest.config.*`、`mutator.config.*`と、Vitestの設定から解決した設定ファイル・
   `setupFiles`・`globalSetup`（`scripts/mutation-scope.ts`）を上書きする。mutatorは、Node.jsの版、
   mutatorの設定、これらのファイルの中身から作る環境ハッシュが一致する時だけ、基準と比べるため。
3. `pnpm install --frozen-lockfile --offline --ignore-scripts`と`wxt prepare`の後、全件を実行する。
4. 基準のコミットの元のVitestとmutatorの設定で、集めていたテストファイルとミューテーションテストの対象を
   一覧にし、今の設定での一覧と比べる。基準で集めていたファイルが、今も残っている（gitが改名と見た時は
   改名先が残っている）のに今は集めていなければ失敗にする。include / excludeを狭めたり、テストの拡張子を
   変えて対象から外したりすると、基準も今の設定で作るため、テストが弱くなったとは判定できないから。
   改名だけなら失敗にしない。
5. 作業ツリーの`.mutator`を捨てて基準のsnapshotに置き換え、
   `mutator --since <共通の祖先> --include-test-changes --kill-matrix`で差分と、変更したテストが確かめる
   コードのミュータントを実行し、`scripts/check-mutation-findings.ts`で判定する。worktreeは最後に消す。
   判定では、mutatorの`detectionRegression`に加えて、基準と今のレポートを突き合わせる。ソースが変わって
   いないファイルのミュータントで、基準では`Killed`だったのに今は`Survived`か`NoCoverage`のものも、
   テストが弱くなったとして失敗にする。基準が`Timeout`のものは、今`NoCoverage`になった、覆うテストが
   変わった、またはテストを消した時に限って失敗にする。mutatorは基準が`Killed`の時だけ比べるので、マシンの
   負荷が高く基準で`Timeout`になると見逃すため。`Timeout`には検出したテストが記録されず、負荷で検出しない
   ミュータントが`Timeout`になることもあるので、変更で説明できる時だけに絞っている。
   さらに、基準で`Killed`になり、その時の検出したテストに変えたか消したテストと変わっていないテストの
   両方を含み、関数の中身が変わっておらず、今も検出したことになっているミュータントは、前の結果を
   使わずに`mutator --only`で2回実行し直し、どちらかで検出されなければ失敗にする
   （`scripts/mutation-recheck.ts`）。mutatorは、前に検出したテストのどれかが変わっていなければ前の
   `Killed`を使い回す。負荷で関係の無いテストがたまたま落ちて検出したテストに数えられると、本当に検出して
   いたテストを弱めても見逃すため。

- 基準を作れない時（worktreeの準備や依存の導入に失敗した、ベースのテストが今の環境で落ちる、など）も
  失敗にします。通すと、ベースのテストを動かなくする変更とテストを消す変更を同時に入れた時に見逃すため
  です。多くは依存の更新でテストが壊れた時で、その場合は通常のテストも落ちます。エラーには出力の末尾と
  直し方を書きます。テストが読むファイル（`setupFiles`から読む設定など）を足した時は、
  `mutation:diff: copied`の行に入っているかを確かめ、入っていなければ`scripts/mutation-diff.sh`が写す
  ファイルに足してください。
- 基準を作ったのにmutatorが比べられなかった（レポートの`comparison`が`unavailable`）時も、仕組みの故障として
  失敗にします。
- レポートが壊れている、形が違う（`schemaVersion`が`2`でない、`findings` / `comparison`が無い）、
  基準のrefが無い時も失敗にします。
- `vitest.config.*`、Vitestの設定から解決した`setupFiles` / `globalSetup`、`mutator.config.*`、
  `mutator.accepted.json`が変わると、ファイルを付けた警告を出します。
- 所要時間は、このテンプレートで20〜30秒ほどです（基準の全件が大半）。`--kill-matrix`の分は数秒です。

機械では確かめられないものがあります。

- テストの設定と準備ファイル（`vitest.config.*`、`setupFiles`、`globalSetup`）を変えたPRは、人が確かめます。
  準備ファイルで`expect`を無力化するような変更は、ミューテーションテストでは見つかりません。判定の
  スクリプト（`scripts/mutation-*.ts`、`scripts/check-mutation-findings.ts`、`scripts/mutation-diff.sh`）や、
  `package.json`の`scripts`の書き換えも同じです。
- 関数を書き換えて、同時にそのテストを消すと、書き換えた箇所のミュータントは「検出できないミュータント」
  （警告）になり、失敗にはなりません。`detectionRegression`は、変わっていないコードだけを比べるためです。
- 破壊的な依存の更新とテストの直しを同じPRに入れると、基準（直す前のテスト）が今の依存で落ちるため、
  必ず「基準を作れない」で失敗します。新旧どちらの依存でも動くテストの直しを先に`main`へ入れてから、
  依存を上げます。どうしても分けられない時は、管理者が判断します。
- テストがファイルシステムから読むデータ（fixtureなど）の変更は、環境ハッシュにも比べる対象にも入らず、
  検出しません。

mutator自体が変わって判定が黙って外れていないかは、`pnpm test:mutation-guard`
（`scripts/mutation-guard.sh`）で確かめます。この作業ツリーを一時的なリポジトリに写し、変更が無ければ
`scripts/mutation-diff.sh`が通り、`src/core/tabs.test.ts`を消すと「テストが弱くなった」で失敗することを
確かめます（1分ほど）。CIの`mutation`ジョブが毎回実行するので、Dependabotがmutatorを上げたPRでも動きます。

実行する場所ごとの違いは次のとおりです。

- **手元**: `pnpm check`の最後で`pnpm mutation:diff`を実行します。pre-pushも`pnpm check`なので、
  テストを弱めた変更ならpushが止まります。`origin/main`が無い環境（`.git`の無い展開先や
  `origin`の無いclone）では、その旨を表示して何もしません。基準の`pnpm install`はオフラインなので、
  先に作業ツリーで`pnpm install`を済ませておきます。
- **CI**: `mutation`ジョブは、PRで`scripts/mutation-diff.sh --kill-matrix origin/<base>`を実行します。
  ベースブランチが`main`以外でも、共通の祖先を基準にします。`mutator.config.*` /
  `mutator.accepted.json`を変えたPRには警告を出します。続けて、どのイベントでも`pnpm test:mutation-guard`を
  実行し、判定が失敗しても全件を実行して、
  全体のスコアをジョブの概要に出します。pushと週1回の定期実行では全件だけを実行します。
  `.github/settings/ruleset-main.json`は、`mutation`をマージに必須のチェックにしています。
- `pnpm mutation` / `pnpm mutation:diff`を単独で実行する前に、`pnpm typecheck`（または
  `pnpm exec wxt prepare`）で`.wxt/`を作っておきます。`pnpm test`と同じ前提です。
- 検出できなかったミュータントは、テストが足りないのか、コードが要らないのかを考えます。
  テストを足すときは、呼び出す側から見える振る舞いを確かめます。数字を満たすためだけのテストは
  書きません。手順は`node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md`にあります。
- どんな入力でも振る舞いが変わらない等価ミュータントだけを、理由を付けて
  `mutator.accepted.json`に記録します。キーは`pnpm exec mutator --reporter agent`の出力の
  `gaps[].key`にあります。

  ```bash
  pnpm exec mutator accept <key> --reason "equivalent: <理由>"
  ```

外すときは、次を消します。

1. `package.json`の`mutation` / `mutation:diff` / `mutation:findings` / `test:mutation-guard`スクリプト、`check`の
   `&& pnpm mutation:diff`、`clean`の`.mutator`
2. `scripts/mutation-diff.sh`、`scripts/mutation-guard.sh`、`scripts/mutation-scope.ts`とそのテスト、`scripts/mutation-recheck.ts`、`scripts/mutation-findings.ts` / `scripts/check-mutation-findings.ts`とそのテスト、
   `scripts/fixtures/mutator-*.json`
3. `mutator.config.json`と`mutator.accepted.json`
4. devDependencyの`@mizchi/mutator`（`pnpm remove @mizchi/mutator`）
5. `.github/workflows/ci.yml`の`mutation`ジョブと、`.github/settings/ruleset-main.json`の
   `mutation`
6. `.mutator`の除外（`.gitignore`、`biome.json`、`.rumdl.toml`、`.fallowrc.json`、
   `scripts/ja-space-files.ts`）
7. `AGENTS.md`とこのREADMEのmutatorの記述

## lefthook（Gitフック）

[lefthook](https://lefthook.dev/) でpre-commit / pre-pushフックを管理します。

- フックは`prepare`スクリプト（`pnpm install` → `lefthook install`）でインストールされます。
- フックをスキップするには`LEFTHOOK=0`を設定します（例: `LEFTHOOK=0 git commit ...`）。
- `pre-commit`はstagedの対象ファイルに`biome check --write`（`**/*.{js,jsx,ts,tsx,json,css}`）と`rumdl check`（`**/*.md`）、日本語タイポグラフィの`--fix`（`**/*.{md,ts,tsx,js,yml,yaml,sh,html}`）を実行し、修正をstageします。globは再帰形なのでサブディレクトリのファイルも対象です。
- `pre-push`は`pnpm check`（lint + typecheck + test + fallow + mutation:diff）を実行します。テストを弱めた変更は`mutation:diff`で止まります（[mutator](#mutatorミューテーションテスト)）。
- 設定は [`lefthook.yml`](./lefthook.yml)。
- `lefthook`は`2.2.1`に固定しています。npm provenanceを持ち、かつ7日ポリシーを満たす後続リリースが出るまでは`2.2.1`のままにします（その条件を満たした時点で上げます）。

---

## Markdown lintと日本語タイポグラフィ

### rumdl（Markdown lint）

Markdownは[rumdl](https://github.com/rvben/rumdl) 0.3.2で検査します（`pnpm lint:md`）。
単一のネイティブバイナリで、install / postinstallスクリプトを持たず、JSランタイム依存もありません。
設定は [`.rumdl.toml`](./.rumdl.toml) で、`flavor = "standard"`（GFM込み）です。
日本語ドキュメントのため`MD013`（行長）のみ無効化し、それ以外の既定ルール（`MD033`を含む）は有効のままです。

### ja-space（日本語と英数字の間の空白）

日本語と英数字の間に半角スペース（`U+0020`）を入れません。字間はレンダラーの仕事です。
`scripts/lint-ja-space.ts`（`pnpm lint:ja-space`）が両方向（`日本語 URL` / `URL の`）を検出し、
`--fix`で除去します。

- 対象外: コードスパン / コードブロック / URLの内側。YAML front matterも対象外。
- 例外: Markdownリンク / 画像の直後（`](...)` / `][ref]`）と、issue参照`#123`の直後の空白は許可。
- 日本語と隣接するインラインコードスパンの外側の空白は削除します（バッククォートをASCIIとして扱う。GitHub / CommonMarkのレンダリングは壊れません）。

`src`と`scripts`のTypeScriptは、[`scripts/ja-space.test.ts`](./scripts/ja-space.test.ts) などで検証します。
`pnpm lint` / `pnpm check`の一部として実行されます。

---

## サプライチェーン / セキュリティ

- **pnpm設定**（`pnpm-workspace.yaml`）:
  - `minimumReleaseAge: 10080`（7日）— 公開から7日未満のパッケージはインストールしない。`minimumReleaseAgeExclude`やtrust-policyの除外は使わず、`pnpm lint:pnpm-policy`でも拒否する。直接依存は、その時点で7日以上経過した最新の安定版にピンする（例: `effect@4.1.2`、`@biomejs/biome@2.6.4`、`vite@8.3.5`）。
  - `onlyBuiltDependencies: []` — installスクリプトは既定でブロック。lefthookのpostinstallは無視して問題ありません（バイナリはoptionalDependenciesから入り、フックは`prepare`で入れます）。
  - `trustPolicy: no-downgrade` / `blockExoticSubdeps: true`。
  - 常に`pnpm-lock.yaml`をコミットし、CIは`pnpm install --frozen-lockfile`を使用。
- **GitHub Actions**:
  - `uses:`は**可読なバージョンタグ**（例: `actions/checkout@v7.0.1`）で書き、実行時のpinはGAのワークフロー依存ロックファイル`.github/workflows/actions.lock`（`gh actions-lock`）で管理。lockfileは手編集しない。
  - 権限は最小（`contents: read`、artifactを上げるジョブのみ`actions: write`）。`actions/checkout`は`persist-credentials: false`。
  - `pull_request_target`は使用しません。CodeQLジョブだけ`security-events: write`（とpacks取得用の`packages: read`）を付与します。dependency reviewは`contents: read`のみです。

---

## リポジトリ設定チェックリスト

以下はファイルでは設定できません。リポジトリのSettingsから手動で行ってください。脆弱性の報告方法は [`SECURITY.md`](./SECURITY.md) を参照してください。

一部の設定は`scripts/github-settings.sh`でコード化しています（後述）。

1. **Settings → Advanced Security**: Dependabot alerts、Dependabot security updates、Dependabot malware alertsをオンにする。
2. **Secret scanning** と **push protection** をオンにする（公開リポジトリでは利用できます）。
3. **Private vulnerability reporting** をオンにする（手順は [`SECURITY.md`](./SECURITY.md)）。
4. **`.github/workflows/actions.lock`をコミットし、`verify-lockfile`ジョブが通ってから** Settings → Actions → Policiesで **Require lockfile** をActiveにする。lockfileが無い状態でActiveにするとワークフローが止まります。FreeプランにEvaluateモードはありません。
5. **`main`のブランチルールセット**（Settings → Rules → Rulesets）: 直接pushを禁止し、PRを必須にする。必須ステータスに`lint` / `fallow` / `typecheck` / `test` / `mutation` / `build` / `e2e` / `nix` / `verify-lockfile` / CodeQL / dependency-reviewを含める。force pushを禁止する。
6. 拡張を **GitHub Releases** で配るときに **immutable releases** をオンにする。

---

## リポジトリ設定のコード化（`scripts/github-settings.sh`）

セキュリティ設定と`main`のルールセットをJSONとして管理します。

```bash
./scripts/github-settings.sh --check   # 読み取り専用でドリフトを検出（既定）
./scripts/github-settings.sh --apply   # 望ましい状態を書き込む
```

- リポジトリは`--repo OWNER/REPO`か第1引数、省略時は`gh repo view`から取得します。
- 望ましい状態は [`.github/settings/security.json`](./.github/settings/security.json) と
  [`.github/settings/ruleset-main.json`](./.github/settings/ruleset-main.json)。
- `--check`は書き込みません。ドリフトがあると非0で終了します。
- **Actionsの "Require lockfile" はAPIでは設定できません**（[github/rest-api-description#7366](https://github.com/github/rest-api-description/issues/7366)）。
  Settings → Actions → PoliciesのUIから手動で設定してください。スクリプトはこの項目を扱いません。
- 依存には`gh`と`jq`が必要です。

---

## 主なスクリプト

| スクリプト        | 内容                               |
| ----------------- | ---------------------------------- |
| `pnpm dev`        | 開発サーバ（ブラウザ自動起動なし） |
| `pnpm build`      | 本番ビルド（`.output/chrome-mv3`） |
| `pnpm zip`        | 配布用zipを作成                  |
| `pnpm typecheck`  | `wxt prepare` + `tsc --noEmit`     |
| `pnpm lint`       | `biome ci` + `rumdl check .` + `lint:ja-space` + `lint:pnpm-policy` + `lint:no-suppress`（format + lint + assist + Markdown + 日本語タイポグラフィ + 供給網ポリシー + 抑制コメント）|
| `pnpm lint:md`    | `rumdl check .`（Markdownのlint）|
| `pnpm lint:ja-space` | 日本語と英数字の間の半角スペースを検査 |
| `pnpm lint:pnpm-policy` | pnpmの供給網ポリシー（除外キー / 必須設定 / 禁止CLIオプション）を検査 |
| `pnpm lint:no-suppress` | 抑制コメント（`biome-ignore` / `@ts-*` / `eslint-disable` / `fallow-ignore` / `mutator-disable` / `Stryker disable`）を検査 |
| `pnpm lint:fix`   | Biome + rumdl + 日本語タイポグラフィを自動修正 |
| `pnpm fix`        | `lint:fix`の別名 |
| `pnpm test`       | Vitestユニットテスト              |
| `pnpm test:coverage` | Vitest + カバレッジ（text/lcov/html → `coverage/`） |
| `pnpm test:watch` | Vitestウォッチ                    |
| `pnpm test:e2e`   | ビルド + Playwright E2E            |
| `pnpm fallow`     | fallowでデッドコード / 循環依存 / 重複 / ヘルス / 境界を解析 |
| `pnpm fallow:audit` | `origin/main`を基準にしたfallow監査（新規のみ） |
| `pnpm mutation`   | ミューテーションテスト（`src/core` / `src/services`の全件。結果を表示するだけ） |
| `pnpm mutation:diff` | `origin/main`との共通の祖先で全件を実行して基準を作り、差分と変更したテストが確かめるコードのミュータントを実行して判定。テストを弱めた変更なら失敗する（`scripts/mutation-diff.sh`） |
| `pnpm test:mutation-guard` | 一時的なリポジトリで、変更が無ければ`mutation:diff`が通り、テストを消すと失敗することを確かめる（mutatorを上げた時の見張り。CIで毎回実行） |
| `pnpm mutation:findings` | 直前の結果から、テストを弱めた変更と基準と比べられなかった結果（失敗）、何も検出しない新しいテストと検出できないミュータント（警告）をGitHub Actionsの注釈の形で出す。基準のref（例: `origin/main`）を渡すと、`mutator.config.*` / `mutator.accepted.json`の変更も警告する |
| `pnpm check`      | `lint` + `typecheck` + `test` + `fallow` + `mutation:diff` |
| `pnpm check:all`  | `check` + `test:coverage` + `build` + `test:e2e` + `dedupe:check` |
| `pnpm clean`      | 生成物（`.output` / `.wxt` / `coverage`等）を削除 |
| `pnpm dedupe:check` | `pnpm dedupe --check`            |
| `pnpm run audit`  | `pnpm audit --audit-level moderate`（CIでは週1回の定期実行）。`pnpm audit`と書くとpnpm本体のコマンドが優先され、しきい値が付かない |
| `pnpm settings:check` | GitHub設定のドリフトを検出（読み取り専用）|
| `pnpm settings:apply` | GitHub設定を適用               |

---

## ディレクトリ構成

```text
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

```text
entrypoints  →  layers / services  →  core
```

- `src/core`は **`chrome.*` / WXT / layersをimportしてはいけません**（純関数のみ）。
- 境界データ（メッセージ、`chrome.storage`、タブURL）は必ず **Effect Schemaでdecode** します。
- 詳細な規約は [`AGENTS.md`](./AGENTS.md) を参照してください。

---

## サンプル機能

ポップアップの **「現在のタブのURLを保存」** ボタン:

1. ポップアップ → `chrome.runtime.sendMessage`でbackgroundに要求
2. background（Service Worker）が現在のタブURLを取得し、検証・重複排除
3. `chrome.storage.local`に永続化
4. ポップアップが保存済みURL一覧を再表示

状態は必ず`chrome.storage`に永続化され、Service Workerが停止しても失われません。
