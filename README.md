# KumiBooks

運用会社共同帳簿システム — Telegram自然文記帳 × Claude API × Google Sheets。

仕様書: [`KumiBooks_spec_v1.md`](./KumiBooks_spec_v1.md)

## 開発進捗

- [x] **Sprint 1**: プロジェクト土台 / Sheetsクライアント / 環境変数zod検証 / Telegram `/whoami`
- [x] **Sprint 2**: 自然文記帳 (Claude Opus 4.7 Function Calling) + 確認ボタン + audit_log fail-closed
- [x] **Sprint 3**: 残高・損益照会 (`/balance` `/today` `/month` `/list` `/undo`) + 自然文での照会
- [x] **Sprint 4**: 月次レポート Cron (Vercel Cron毎月1日朝発火、Telegram投稿+monthly_summary行追加)
- [ ] Sprint 5: エラーハンドリング強化 / READMEと受け入れテスト整備

### Sprint 2 で動くこと

- 「広告費5000円」「FX +3万」「田中さんから50万入金」のような自然文をTelegramに送ると、AIが構造化して確認カードを返す
- ✅ボタンで `transactions` シートに append、`audit_log` シートにbefore/after記録（fail-closed: 監査ログ失敗で取引中止）
- ❌でキャンセル、5分間操作なしで自動失効
- 不確かな抽出は `review_flag=true` で記録され、確認カードに警告表示
- LLMはOpus 4.7プライマリ → Sonnet 4.6フォールバック（5xx/rate-limited時）
- カテゴリマスタを動的にプロンプトへ注入（5分キャッシュ）
- 投資家・関係者名は `counterparty` カラムへ正規化

### Sprint 3 で動くこと

- `/balance` — 現在残高（type×categoryで符号付き合算）+ 今月集計
- `/today` — 本日（JST）の取引一覧
- `/month` — 今月の収入/経費/FX損益/純損益/出資受入/分配
- `/list [n]` — 直近 n 件 (1〜50、デフォルト10、新→旧)
- `/undo` — 自分が記帳した最後のactiveトランザクションを論理削除（status=deleted、audit_log記録、物理削除はしない）
- 自然文照会（「今月の利益は？」「田中さんからの入金合計」など）→ 集計値+直近80件のコンテキストを Claude へ渡して回答
- 残高計算ルール: income +/ expense -/ fx_pnl±(category)/ deposit +/ withdrawal -/ transfer 0 (intra-pool)

### Sprint 4 で動くこと

- Vercel Cron `5 0 1 * *` (JST 09:05 毎月1日) に `/api/cron/monthly-report` が発火
- 前月の active トランザクションを集計し以下を生成:
  - 月次サマリー（収入/経費/FX損益/純損益/入出金）
  - 月末（EOM）残高（前月末日までの累積符号付き合算）
  - 出資者別残高（counterparty 一致で deposits − withdrawals）
- Telegram グループへ整形レポートを投稿
- `monthly_summary` シートに1行追加（§2.5 A..I 順）
- 重複ガード: 同じ year_month の行が既に存在する場合は post もappendもスキップ
- 手動実行: `curl -H "Authorization: Bearer $CRON_SECRET" "https://host/api/cron/monthly-report?ym=2026-03&force=1"`

#### 仕様 §8.1 からの逸脱（重要）

仕様書のCron表記 `5 15 1 * *` は説明文に「JST 0:05」と書かれているが、実際は UTC 15:05 = JST 翌日 00:05 で発火するため、
日付が1日ずれる。本実装では `5 0 1 * *`（UTC 00:05 day 1 = JST 09:05 day 1）に訂正した。
- レポート対象月の判定はサーバ側で「前月」を計算するためタイミングは結果に影響しない
- 配信時刻を JST 早朝にしたい場合は `5 14 28-31 * *` 等で複数候補日に発火 → サーバ側で「last day判定」する案もあるが v1 はシンプルに当日朝で運用

## Sprint 1 セットアップ

### 1. 依存をインストール

```bash
npm install
```

### 2. Google Sheets を準備

1. GCP Console で新規プロジェクトを作成し、**Google Sheets API** を有効化。
2. **Service Account** を作成し、JSON鍵を発行。
3. Google Sheets で新しいスプレッドシートを作成（名前: `KumiBooks_Master`）。
4. 仕様書 §2 のシート 7 つ（`transactions` / `investors` / `categories` / `wallets` / `monthly_summary` / `audit_log` / `members`）を作成し、1行目にヘッダーを入れる。
5. スプレッドシートを Service Account の email に「編集者」として共有。
6. URLから `GOOGLE_SHEETS_ID` を控える。

### 3. Telegram Bot を準備

1. [@BotFather](https://t.me/BotFather) で新規Botを作成し、`TELEGRAM_BOT_TOKEN` を取得。
2. 仲間用の Telegram グループを作成し、Botを招待。
3. グループ内で何かメッセージを投げ、Bot APIの `getUpdates` でグループ ID を取得（`-100…` の数字）→ `TELEGRAM_GROUP_ID`。
4. `TELEGRAM_WEBHOOK_SECRET` を任意の長いランダム文字列で生成。

### 4. 環境変数

`.env.local.example` を `.env.local` にコピーして埋める。`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` の改行は `\n` でエスケープ。

### 5. ローカル起動

```bash
npm run dev
# → http://localhost:3000
# ヘルスチェック: http://localhost:3000/api/health
```

### 6. Webhook を Telegram に登録

ngrok などで HTTPS 公開後、以下を一度叩く：

```bash
curl -F "url=https://<your-public-host>/api/telegram/webhook?secret=<TELEGRAM_WEBHOOK_SECRET>" \
     -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook"
```

`secret_token` は `X-Telegram-Bot-Api-Secret-Token` ヘッダとして送られ、サーバ側で照合される。

### 7. 動作確認

1. `members` シートに自分の Telegram ID（`/whoami` で取得可能）と `active=TRUE` を追加。
2. グループで `/whoami` → 自分の `tg_id` と権限が返ってくれば Sprint 1 OK。
3. `/help` で実装済みコマンド一覧が見える。

## ディレクトリ構成

```
.
├── app/
│   ├── api/
│   │   ├── health/route.ts          ヘルスチェック
│   │   ├── telegram/webhook/route.ts Telegram受信
│   │   └── cron/monthly-report/route.ts 月次レポート (Bearer auth)
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── llm/
│   │   ├── client.ts                 Anthropic SDK + fallback
│   │   ├── prompts.ts                System prompt + record_transaction tool
│   │   ├── parse-transaction.ts      自然文→ParsedTransaction
│   │   └── answer-query.ts           照会LLM (集計値+直近80件をcontext)
│   ├── sheets/
│   │   ├── client.ts                 Sheets API ラッパ
│   │   ├── members.ts                仲間allowlist
│   │   ├── categories.ts             カテゴリマスタ (5分TTLキャッシュ)
│   │   ├── transactions.ts           append + listActive + markDeleted (fail-closed)
│   │   ├── investors.ts              listInvestors + computeInvestorBalances
│   │   └── audit.ts                  logAudit (fail-closed)
│   ├── reports/
│   │   ├── aggregate.ts              computeBalance / computeMonthly / filter
│   │   └── monthly.ts                月次レポート生成 + Telegram投稿 + シート追記
│   ├── telegram/
│   │   ├── bot.ts                    sendMessage / editMessageText / answerCallbackQuery
│   │   ├── commands.ts               /whoami /help /balance /today /month /list /undo
│   │   ├── format.ts                 確認カード・記帳済みカードのレンダ
│   │   └── handlers.ts               update + callback_query dispatcher
│   └── utils/
│       ├── env.ts                    zod環境変数検証
│       ├── logger.ts                 シークレット自動マスキング構造化ログ
│       ├── id.ts                     UUID / token / JST today
│       └── pending.ts                Pending state (Upstash REST + memory fallback)
├── types/
│   └── transaction.ts                TxType / ParsedTransaction / PendingTransaction
├── .env.local.example
├── KumiBooks_spec_v1.md
├── next.config.mjs
├── package.json
├── tsconfig.json
└── vercel.json
```

## スクリプト

| コマンド | 動作 |
|---------|------|
| `npm run dev` | 開発サーバ起動 |
| `npm run build` | プロダクションビルド |
| `npm run start` | プロダクション起動 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

## セキュリティ覚え書き

- Webhookは `?secret=` クエリと `X-Telegram-Bot-Api-Secret-Token` ヘッダの **両方** を検証
- メンバーは `members` シートで `active=TRUE` のみ操作可
- グループID違いのメッセージは無視
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` などは `lib/utils/logger.ts` でログ自動マスキング
- 確認ボタン (`callback_query`) は記帳者本人のtg_idのみ受け付け
- audit_log は **fail-closed**: 監査ログ書き込み失敗時は `transactions` も書かない

## Pending state について

Sprint 2 で導入した記帳確認の一時保存先：

- `UPSTASH_REDIS_REST_URL` / `_TOKEN` を設定すると Upstash Redis を使用（5分TTL）
- 未設定なら in-memory Map（dev用） — **Vercel Serverless本番ではインスタンス間で状態共有されないため Upstash 必須**

ローカル開発なら未設定で動くが、本番デプロイ時は Upstash Redis を必ず構成する。
