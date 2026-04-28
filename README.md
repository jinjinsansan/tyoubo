# KumiBooks

運用会社共同帳簿システム — Telegram自然文記帳 × Claude API × Google Sheets。

仕様書: [`KumiBooks_spec_v1.md`](./KumiBooks_spec_v1.md)

## 開発進捗

- [x] **Sprint 1**: プロジェクト土台 / Sheetsクライアント / 環境変数zod検証 / Telegram `/whoami`
- [ ] Sprint 2: 自然文記帳 (Function Calling) + 確認ボタン + audit_log
- [ ] Sprint 3: 残高・損益照会、`/balance` `/today` `/month` `/list` `/undo`
- [ ] Sprint 4: 月次レポート Cron
- [ ] Sprint 5: エラーハンドリング強化 / READMEと受け入れテスト整備

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
│   │   └── telegram/webhook/route.ts Telegram受信
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── sheets/
│   │   ├── client.ts                 Sheets API ラッパ
│   │   └── members.ts                仲間allowlist
│   ├── telegram/
│   │   ├── bot.ts                    Bot APIラッパ
│   │   ├── commands.ts               /whoami /help
│   │   └── handlers.ts               update dispatcher
│   └── utils/
│       ├── env.ts                    zod環境変数検証
│       └── logger.ts                 構造化ログ
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
