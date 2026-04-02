# site-crawler

指定した URL を起点に同一ドメインを再帰的にクロールし、ページ情報を NDJSON / JSON / CSV 形式で出力する CLI ツール。

## インストール

```bash
npm install
npm run build
```

## 使い方

```bash
node dist/index.js <url> [options]
```

### 例

```bash
# 基本的なクロール（stdout に NDJSON 出力）
node dist/index.js https://example.com

# 最大 100 ページ、並列数 5 でクロール
node dist/index.js https://example.com --max-pages 100 --concurrency 5

# ファイルに保存
node dist/index.js https://example.com --output result.ndjson

# CSV 形式で出力
node dist/index.js https://example.com --format csv --output result.csv

# output/ ディレクトリに自動命名で保存
node dist/index.js https://example.com --output-dir ./output

# TLS 証明書エラーが出るサイト
node dist/index.js https://example.com --ignore-ssl-errors
```

## オプション

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `--concurrency <n>` | `10` | 並列リクエスト数 |
| `--max-pages <n>` | 無制限 | クロールする最大ページ数 |
| `--delay <ms>` | `0` | リクエスト間の待機時間（ミリ秒）。サーバー負荷を抑えたい場合に指定 |
| `--timeout <ms>` | `10000` | 1 リクエストのタイムアウト（ミリ秒） |
| `--depth <n>` | 無制限 | 最大クロール深度。`0` は起点 URL のみ、`1` は起点から 1 リンク先まで |
| `--output <file>` | stdout | 出力先ファイルパス |
| `--output-dir <dir>` | — | 出力先ディレクトリ。`{ホスト名}_{タイムスタンプ}.{ndjson\|json\|csv}` の形式で自動保存。ディレクトリが存在しない場合は自動作成 |
| `--format <type>` | `ndjson` | 出力形式。`ndjson`（1 行 1 ページ、逐次書き込み）、`json`（全件完了後に JSON 配列として出力）、`csv`（ヘッダー付き CSV、`links` は件数として出力） |
| `--ignore-robots` | `false` | robots.txt を無視してクロール |
| `--ignore-query-params` | `false` | クエリパラメータを除去して URL を正規化。`/page?a=1` と `/page?a=2` を同一 URL とみなす |
| `--ignore-ssl-errors` | `false` | TLS 証明書の検証をスキップ。自己署名証明書や中間証明書が不完全なサイトで使用 |
| `--dedupe-content` | `false` | HTML コンテンツの SHA-256 ハッシュで重複ページを検出し、スキップ |
| `--checkpoint <file>` | — | チェックポイントファイルパス。指定すると 100 ページごとに進捗を保存し、中断後に同じコマンドを再実行すると続きから再開 |
| `--playwright` | `false` | Playwright（Chromium）を使って JS レンダリング後の DOM を取得。SPA 対応が必要な場合に使用 |

## 出力形式

### NDJSON（デフォルト）

1 行につき 1 ページ分の JSON を出力。クロール中にリアルタイムで書き込まれる。

```jsonl
{"url":"https://example.com/","title":"Example","statusCode":200,"depth":0,"links":[...],...}
{"url":"https://example.com/about","title":"About","statusCode":200,"depth":1,"links":[...],...}
```

### CSV（`--format csv`）

ヘッダー行付きの CSV を出力。`links` は件数（`linkCount`）として記録される。

```csv
url,title,metaDescription,statusCode,crawledAt,depth,linkCount,error,redirectedFrom
https://example.com/,Example Domain,,200,2026-03-30T00:00:00.000Z,0,1,,
https://example.com/about,About,,200,2026-03-30T00:00:01.000Z,1,3,,
```

### JSON 配列（`--format json`）

全ページ完了後に JSON 配列として出力。

```json
[
  {"url":"https://example.com/","title":"Example","statusCode":200,...},
  {"url":"https://example.com/about","title":"About","statusCode":200,...}
]
```

### ページオブジェクトのフィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `url` | `string` | クロールした URL（リダイレクト後の最終 URL） |
| `title` | `string \| null` | ページタイトル（`<title>` タグ） |
| `metaDescription` | `string \| null` | メタディスクリプション |
| `statusCode` | `number \| null` | HTTP ステータスコード |
| `crawledAt` | `string` | クロール日時（ISO 8601） |
| `depth` | `number` | 起点 URL からのリンク深度 |
| `links` | `string[]` | ページ内の同一ドメインリンク一覧 |
| `error` | `string \| null` | エラーメッセージ（成功時は `null`） |
| `redirectedFrom` | `string \| null` | リダイレクト元 URL（リダイレクトがない場合は `null`） |

## クロール仕様

- **対象ドメイン**: 起点 URL と同一の登録ドメイン（eTLD+1）に限定。サブドメインも対象（例: `blog.example.com` は `example.com` と同一扱い）
- **除外 URL**: 別ドメイン、`mailto:` / `tel:` / `javascript:` スキーム、画像・PDF・CSS・JS 等の非 HTML ファイル
- **エラー処理**:
  - 4xx: スキップし `error` フィールドに記録
  - 5xx: 最大 3 回リトライ（Exponential backoff）後にスキップ
  - タイムアウト / 接続失敗: スキップし `error` フィールドに記録
- **User-Agent**: `site-crawler/1.0`

## Playwright モード

JavaScript でレンダリングされる SPA（React・Vue 等）をクロールする場合に使用。

```bash
# 事前インストール
npm install playwright
npx playwright install chromium

# 実行
node dist/index.js https://example.com --playwright --max-pages 20
```

> Playwright モードでは並列ページ数が最大 5 に制限されます（Chromium の負荷軽減のため）。

## チェックポイントによる中断再開

長時間のクロールを途中で再開できます。

```bash
# クロール開始（Ctrl+C で中断可能）
node dist/index.js https://example.com --max-pages 1000 --checkpoint cp.json

# 再実行すると続きから再開
node dist/index.js https://example.com --max-pages 1000 --checkpoint cp.json
```

## jq を使った出力の活用例（NDJSON / JSON）

```bash
# エラーがあるページだけ表示
node dist/index.js https://example.com 2>/dev/null | jq 'select(.error != null)'

# depth ごとのページ数を集計
node dist/index.js https://example.com 2>/dev/null | jq -s 'group_by(.depth) | map({depth: .[0].depth, count: length})'

# リンク数が多い順に上位 5 件
node dist/index.js https://example.com 2>/dev/null | jq -s 'sort_by(-(.links | length)) | .[0:5] | .[] | {url, links: (.links | length)}'
```

## CSV を使った活用例

```bash
# CSV で保存して Excel / スプレッドシートで開く
node dist/index.js https://example.com --format csv --output-dir ./output

# linkCount が多い順に表示（mlr コマンド使用）
node dist/index.js https://example.com --format csv 2>/dev/null | mlr --csv sort -nr linkCount head -n 10
```
