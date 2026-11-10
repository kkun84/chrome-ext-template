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
pnpm test:e2e     # ビルド + Playwright
```

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
