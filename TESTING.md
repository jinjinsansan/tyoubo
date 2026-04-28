# 受け入れテスト & デバッグ手順

仁さん向けの手動テストシナリオです。仕様書 §12 を実機で順に確認するためのチェックリスト。

## 前提

- `.env.local` 設定済み
- [docs/SHEETS_SETUP.md](./docs/SHEETS_SETUP.md) のチェックリスト全クリア
- `npm run dev` が動いている、または Vercel Preview にデプロイ済み
- ngrok 等で Webhook URL が公開済み（ローカルテストの場合）
- `members` シートに自分の tg_id が `active=TRUE` で登録済み

### Webhook を Telegram に登録（初回のみ）

```bash
curl -F "url=https://<host>/api/telegram/webhook?secret=$TELEGRAM_WEBHOOK_SECRET" \
     -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
```

成功時のレスポンス: `{"ok":true,"result":true,"description":"Webhook was set"}`

確認:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

## §12.1〜9 受け入れテスト（順に実施）

### ✅ 12.1 経費の自然文記帳

**入力**: `広告費5000円`

**期待結果**:
1. Bot が確認カードを返す（種別=経費、金額=¥5,000、カテゴリ=ad_cost、信頼度表示）
2. ✅ ボタンを押す → 「✅ 記帳しました」に書き換わる、id 表示
3. `transactions` シートに新しい行が追加されている（amount=5000, type=expense, category=ad_cost, status=active）
4. `audit_log` シートに `action=create, target_table=transactions, before=空, after={...}` の行が追加されている

### ✅ 12.2 FX損益の記帳

**入力**: `FX +3万`

**期待結果**:
1. 確認カード: 種別=FX損益、金額=¥30,000、カテゴリ=fx_profit
2. ✅ → `transactions` に type=fx_pnl, category=fx_profit で追加
3. `/balance` で残高が +30,000 増えている

### ✅ 12.3 投資家入金

**入力**: `田中さんから100万入金`

**期待結果**:
1. 確認カード: 種別=投資家入金、金額=¥1,000,000、カテゴリ=investor_in、関係者=田中さん
2. ✅ → `transactions` に type=deposit, counterparty=「田中さん」で追加
3. `/balance` で残高 +1,000,000

### ✅ 12.4 残高照会コマンド

**入力**: `/balance`

**期待結果**:
- 「🪙 残高 (現在)」見出しの後、合計 (JPY)、記帳件数
- 「📅 YYYY-MM の集計」: 収入/経費/FX損益/純損益/出資受入/分配・返金
- 12.1〜12.3 の合計が反映されている

### ✅ 12.5 自然文での集計照会

**入力**: `今月の利益は？`

**期待結果**:
- LLM が現在月の純損益を引用して短文で回答
- 数値は¥1,234,567形式で3桁区切り
- 「データにない」期間を聞かれたら「データにありません」と返す

### ✅ 12.6 /undo

**入力**: `/undo`

**期待結果**:
- 自分が記帳した最後の active トランザクションが対象
- レスポンス「↩️ 取り消しました」+ 内容
- `transactions` シートのその行: M=deleted, N=削除日時, O=自分の名前
- `audit_log` に `action=delete, before={...active...}, after={...deleted...}` の行
- 元の物理行は消えていない（論理削除のみ）
- もう一度 `/undo` → 1件前の自分の記帳が削除される
- 他人の記帳は対象にならない

### ✅ 12.7 月次レポート Cron

**手動発火**:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://<host>/api/cron/monthly-report?ym=2026-03&force=1"
```

**期待結果**:
- レスポンス: `{"ok":true,"yearMonth":"2026-03","alreadyReported":false,...,"telegramMessageId":<int>}`
- Telegram グループに「📊 2026年03月 運用レポート」が投稿される
- `monthly_summary` シートに 1 行追加（A=2026-03、B〜I 集計値）
- 同じコマンドを `force=0` で再実行 → `alreadyReported:true` でスキップされ、Telegram には投稿されない

### ✅ 12.8 非メンバー拒否

**準備**: 別のTelegramアカウント（または `members` から自分を `active=FALSE` にして再起動）

**期待結果**:
- メッセージを送ると Bot は無反応 or 「membersシートに登録されていません」と返す
- `transactions`/`audit_log` には何も追加されない

### ✅ 12.9 Sheets 直接編集の反映

**入力**: スプレッドシートで `transactions` の任意行の amount を手動変更

**期待結果**:
- `/balance` を再度送ると変更後の値が反映される
- 自然文照会も同様

## デバッグ Tips

### 動作不良時の最初に見るべき所

| 症状 | 確認ポイント |
|------|------------|
| Bot が無反応 | Vercel Logs / `npm run dev` ターミナル / `getWebhookInfo` の `last_error_message` |
| 401 Unauthorized | `?secret=` クエリと `secret_token` ヘッダの両方が一致しているか |
| Sheets 書き込み失敗 | Service Account にスプレッドシート編集権が付いているか / `GOOGLE_SHEETS_ID` 正しいか |
| LLM 応答せず | `ANTHROPIC_API_KEY` 残高、`LLM_PRIMARY_MODEL`/`_FALLBACK_MODEL` の値 |
| カテゴリが認識されない | `categories` シートのスペル / 5分のキャッシュ待ち |
| `/balance` が0 | `members.active=TRUE` で記帳ユーザーが許可されているか |

### ログ

すべて構造化JSONでstderr/stdoutに出力。Vercel Logs で `scope` フィールドで絞り込み可：

```
scope=webhook    # /api/telegram/webhook
scope=handler    # update dispatcher
scope=cmd        # /balance /undo 等
scope=parse-tx   # LLM Function Calling
scope=answer-query  # 自然文照会
scope=tx         # transactions sheet append
scope=audit      # audit_log
scope=monthly-report  # cron
scope=rate       # rate limit
```

シークレットは `lib/utils/logger.ts` で自動マスキング（`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` 等）。

### Pending state がローカルで消える

In-memory 実装のため `npm run dev` 再起動で Pending 確認カードがロストする。本番では Upstash Redis を設定（README §Pending state について）。

### 月次レポートが二重送信された

`monthly_summary` シートで重複行を1つ削除し、`?force=1` で再実行。`generateMonthlyReport` は同月に1度しか送らない（重複ガード）が、手動 force で意図的にバイパス可能。

## ヘルスチェック

```bash
curl https://<host>/api/health
# {"ok":true,"service":"kumibooks","version":"0.1.0",...}
```

## Webhook を一時停止するには

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
```
