# 運用会社共同帳簿システム 実装仕様書 v1.0

**For: Claude Code**
**作成: 2026-04-28**
**プロジェクトコード名: KumiBooks（組み帳簿）**

---

## 0. プロジェクト概要

仁さん率いる少額運用会社（FX運用 + 投資家からの預かり + 別事業利益）の共同帳簿システムを構築する。仲間全員が Telegram から自然文で記帳でき、Claude API（claude-opus-4-7）が解釈して Google Sheets に書き込む。残高・損益の照会も Telegram での会話で完結。月末は自動で月次レポートを配信。

### 設計原則
1. **真実の正本は Google Sheets**：仲間全員がいつでもブラウザで全データを閲覧・編集可能
2. **入力は Telegram**：仲間が日常的に使うチャネルから離脱させない
3. **AI は橋渡し**：自然文 → 構造化データ、構造化データ → 会話的な返答
4. **監査可能**：全ての記帳に「誰が・いつ・何を」を記録、削除は論理削除のみ
5. **既存スタックに統合**：仁さんの ClawdBot/OpenClaw VPS、Vercel Cron、Telegram通知の流儀に合わせる

### 非ゴール（やらないこと）
- 複式簿記の厳密な実装（単式・現金主義で十分）
- 確定申告対応の自動化（税理士領域）
- リアルタイムFXレート取得（手動入力でOK）
- ユーザー認証画面（Telegram User ID で識別）

---

## 1. 技術スタック

| レイヤー | 技術 | 理由 |
|---------|------|------|
| データ正本 | Google Sheets（Sheets API v4） | 仲間が直接見れる・編集できる |
| アプリケーション | Next.js 14 App Router (TypeScript) | 仁さん既存スタック |
| ホスティング | Vercel | Cron込み・既存環境 |
| LLM | Anthropic Claude API | メイン: `claude-opus-4-7`、フォールバック: `claude-sonnet-4-6` |
| 入力UI | Telegram Bot (Bot API) | 仲間の日常チャネル |
| ロック・キュー | Upstash Redis（任意） | Sheets同時書き込み競合対策 |
| シークレット管理 | Vercel 環境変数 | 既存運用と同じ |

---

## 2. Google Sheets スキーマ

スプレッドシート名: `KumiBooks_Master`

以下7シートを作成。**全シートの1行目はヘッダー固定**。アプリは`SHEET_ID` を環境変数で読む。

### 2.1 `transactions`（取引履歴・メインテーブル）

| 列 | カラム名 | 型 | 説明 |
|---|---------|---|------|
| A | id | string | UUID v4 |
| B | created_at | ISO8601 | 記帳日時（システム自動） |
| C | tx_date | YYYY-MM-DD | 取引発生日（自然文から抽出） |
| D | type | enum | `income`/`expense`/`fx_pnl`/`deposit`/`withdrawal`/`transfer` |
| E | amount | number | 金額（正の数） |
| F | currency | string | `JPY`/`USD` 等、デフォルト`JPY` |
| G | category | string | カテゴリマスタを参照 |
| H | counterparty | string | 取引先・関係者（任意） |
| I | memo | string | メモ |
| J | recorded_by_tg_id | number | 記帳者のTelegram User ID |
| K | recorded_by_name | string | 記帳者の表示名 |
| L | source_message | string | 元のTelegramメッセージ全文 |
| M | status | enum | `active`/`deleted`（論理削除） |
| N | deleted_at | ISO8601 | 削除日時 |
| O | deleted_by | string | 削除者名 |
| P | review_flag | boolean | LLMが要確認と判断 |

**重要**: type の意味
- `income`: 別事業からの利益・収入
- `expense`: 経費
- `fx_pnl`: FX損益（正なら利益、負なら損失。amountは絶対値、別カラムに sign を持たせず category で `fx_profit`/`fx_loss` を分ける）
- `deposit`: 投資家からの入金（出資 or 預り金）
- `withdrawal`: 投資家への返金・分配
- `transfer`: 内部資金移動（口座間など）

### 2.2 `investors`（出資者台帳）

| 列 | カラム名 | 型 | 説明 |
|---|---------|---|------|
| A | id | string | UUID |
| B | name | string | 投資家名 |
| C | tg_id | number | Telegram ID（任意、参加してれば） |
| D | role | enum | `partner`（仲間）/`investor`（外部投資家） |
| E | total_deposited | number | 累計入金（数式 `=SUMIFS(transactions!E:E,...)` で自動） |
| F | total_withdrawn | number | 累計出金 |
| G | current_share | number | 現在の出資残高（自動） |
| H | share_ratio | number | 持分比率（手動更新 or 数式） |
| I | notes | string | メモ（契約形態など） |
| J | joined_at | YYYY-MM-DD | 参加日 |

### 2.3 `categories`（カテゴリマスタ）

| 列 | カラム名 | 型 |
|---|---------|---|
| A | category_id | string |
| B | category_name | string |
| C | tx_type | type に対応 |
| D | description | string |

**初期データ**:
```
fx_profit       | FX利益       | fx_pnl    | FX運用利益
fx_loss         | FX損失       | fx_pnl    | FX運用損失
ad_cost         | 広告費       | expense   | 広告・マーケ費用
tool_subscription | ツール費   | expense   | SaaS等
server_cost     | サーバー費   | expense   | VPS等
biz_revenue     | 事業収入     | income    | FX以外の事業利益
investor_in     | 投資家入金   | deposit   | 出資受入
investor_out    | 投資家出金   | withdrawal| 投資家への分配
internal_xfer   | 内部移動     | transfer  | 口座間移動
misc_expense    | その他経費   | expense   | 分類困難なもの
```

### 2.4 `wallets`（口座・財布）

複数口座管理用。FX口座・銀行口座・暗号資産口座などを分ける。

| 列 | カラム名 | 型 |
|---|---------|---|
| A | wallet_id | string |
| B | wallet_name | string |
| C | currency | string |
| D | type | `fx`/`bank`/`crypto`/`cash` |
| E | balance | number（数式自動計算） |
| F | notes | string |

`transactions` シートに `wallet_id` 列を追加する場合は version 2 で検討。v1 は単一プールで OK（仁さん確認可）。

### 2.5 `monthly_summary`（月次サマリー）

ピボット相当を数式で構築。または Cron が毎月1日に書き込む。

| 列 | カラム名 |
|---|---------|
| A | year_month（YYYY-MM）|
| B | total_income |
| C | total_expense |
| D | fx_pnl_net |
| E | net_profit |
| F | deposits_in |
| G | withdrawals_out |
| H | balance_eom |
| I | report_url（Telegram投稿のリンク等）|

### 2.6 `audit_log`（監査ログ）

| 列 | カラム名 | 型 |
|---|---------|---|
| A | log_id | string |
| B | timestamp | ISO8601 |
| C | actor_tg_id | number |
| D | actor_name | string |
| E | action | `create`/`update`/`delete`/`query` |
| F | target_table | string |
| G | target_id | string |
| H | before_value | JSON文字列 |
| I | after_value | JSON文字列 |
| J | source | `telegram`/`web`/`cron`/`api` |

**全ての書き込みは audit_log にも記録する**。これが「結末を良くする」最重要パーツ。

### 2.7 `members`（仲間マスタ）

| 列 | カラム名 | 型 |
|---|---------|---|
| A | tg_id | number |
| B | name | string |
| C | role | `admin`/`member`/`viewer` |
| D | active | boolean |
| E | joined_at | YYYY-MM-DD |

Telegram Bot は `tg_id` がこのシートに存在し `active=true` の場合のみ操作を受け付ける（重要: セキュリティ）。

---

## 3. ディレクトリ構成

```
kumibooks/
├── app/
│   ├── api/
│   │   ├── telegram/webhook/route.ts    # Telegram Webhook受信
│   │   ├── cron/monthly-report/route.ts # 月次レポートCron
│   │   └── health/route.ts              # ヘルスチェック
│   ├── (dashboard)/                     # 後日Web画面追加用に予約
│   └── layout.tsx
├── lib/
│   ├── sheets/
│   │   ├── client.ts                    # Google Sheets APIクライアント
│   │   ├── transactions.ts              # CRUD: transactions
│   │   ├── investors.ts                 # CRUD: investors
│   │   ├── audit.ts                     # 監査ログ書き込み
│   │   └── members.ts                   # 仲間判定
│   ├── llm/
│   │   ├── client.ts                    # Claude APIクライアント（fallback付き）
│   │   ├── parse-transaction.ts         # 自然文 → 構造化（Function Calling）
│   │   ├── answer-query.ts              # 残高・損益の会話照会
│   │   └── prompts.ts                   # システムプロンプト集
│   ├── telegram/
│   │   ├── bot.ts                       # Telegram Bot APIラッパ
│   │   ├── handlers.ts                  # メッセージハンドラ
│   │   └── commands.ts                  # /balance /list /undo 等
│   ├── reports/
│   │   └── monthly.ts                   # 月次集計ロジック
│   └── utils/
│       ├── date.ts
│       ├── currency.ts
│       └── lock.ts                      # Redis分散ロック（任意）
├── types/
│   ├── transaction.ts
│   ├── investor.ts
│   └── llm.ts
├── .env.local.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. 環境変数

`.env.local.example` に以下を記載：

```bash
# ===== Google Sheets =====
GOOGLE_SHEETS_ID=xxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_SERVICE_ACCOUNT_EMAIL=kumibooks@xxxx.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# ===== Anthropic =====
ANTHROPIC_API_KEY=sk-ant-xxxx
LLM_PRIMARY_MODEL=claude-opus-4-7
LLM_FALLBACK_MODEL=claude-sonnet-4-6

# ===== Telegram =====
TELEGRAM_BOT_TOKEN=xxxx:xxxxxx
TELEGRAM_GROUP_ID=-100xxxxxxxxxx
TELEGRAM_WEBHOOK_SECRET=長いランダム文字列  # /api/telegram/webhook?secret=... で検証

# ===== Cron =====
CRON_SECRET=長いランダム文字列              # Vercel Cron認証

# ===== オプション =====
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# ===== Operational =====
TZ=Asia/Tokyo
NODE_ENV=production
```

**Google Service Account の準備**：
1. GCP Console で Service Account を作成
2. JSON鍵を発行
3. 対象スプレッドシートを Service Account の email に「編集者」として共有
4. `private_key` の改行は `\n` でエスケープして環境変数に格納

---

## 5. Telegram 自然文記帳の仕様

### 5.1 受け付ける入力例

```
今日FXで+3万円
広告費5000円
昨日のサーバー代1980円払った
田中さんから50万入金
取引履歴見せて
今月の利益は？
今の残高
直近10件の取引
最後の記帳取り消し
```

### 5.2 処理フロー

```
[Telegramメッセージ受信]
    ↓
[Webhook認証（secret検証）]
    ↓
[送信者がmembers.activeか確認] → NGなら無視 + ログ
    ↓
[コマンド分岐]
    ├─ /で始まる → コマンドハンドラ
    ├─ 質問形式（「？」「教えて」「いくら」「どれくらい」等を含む or LLM判定） → 照会フロー
    └─ それ以外 → 記帳フロー
    ↓
[記帳フロー: Claude API Function Calling]
    ↓
[抽出結果を確認メッセージで返信]
    ├─ ✅で確定 / ✏️で修正 / ❌でキャンセル のインラインボタン
    ↓
[確定 → Sheets書き込み + 監査ログ + 完了通知]
```

### 5.3 コマンド一覧

| コマンド | 動作 |
|---------|------|
| `/balance` | 全口座の現在残高 |
| `/today` | 今日の取引一覧 |
| `/month` | 今月のサマリー |
| `/list [n]` | 直近n件（デフォルト10） |
| `/undo` | 自分が記帳した最後の1件を論理削除 |
| `/categories` | カテゴリ一覧 |
| `/help` | ヘルプ |
| `/whoami` | 自分のtg_idと権限 |

---

## 6. LLM プロンプト仕様

### 6.1 記帳パース用プロンプト（`lib/llm/prompts.ts`）

```typescript
export const PARSE_TRANSACTION_SYSTEM = `
あなたは少額運用会社の帳簿アシスタントです。仲間からの自然文メッセージを解析し、取引データに構造化します。

## あなたの役割
- メッセージから取引情報を抽出
- 曖昧な部分は推測せず review_flag=true を立てる
- 質問・雑談・記帳でないものは is_transaction=false を返す

## カテゴリマスタ
${categoriesList}  // 実行時に動的注入

## 日付の解釈（基準: ${今日の日付（JST）}）
- 「今日」→ 基準日
- 「昨日」→ 基準日 -1
- 「先週」「先月」など曖昧な相対表現は review_flag=true
- 明示がなければ tx_date = 今日

## 通貨
- 「ドル」「USD」「$」→ USD
- 言及なし → JPY

## type の判定基準
- FX関連の利益/損失 → fx_pnl（カテゴリは fx_profit / fx_loss）
- 投資家からの入金 → deposit（金額は正、counterpartyに名前必須）
- 投資家への返金・分配 → withdrawal
- 経費（広告・サーバー・ツール等） → expense
- 別事業の収入 → income
- 口座間移動 → transfer

## 必ず record_transaction Function を呼んで構造化結果を返してください。
`;
```

### 6.2 Function Tool 定義

```typescript
const recordTransactionTool = {
  name: "record_transaction",
  description: "取引を構造化して記録する",
  input_schema: {
    type: "object",
    properties: {
      is_transaction: { type: "boolean", description: "メッセージが取引記帳に該当するか" },
      tx_date: { type: "string", description: "YYYY-MM-DD" },
      type: { type: "string", enum: ["income","expense","fx_pnl","deposit","withdrawal","transfer"] },
      amount: { type: "number" },
      currency: { type: "string", default: "JPY" },
      category: { type: "string" },
      counterparty: { type: "string", description: "取引先・関係者（任意）" },
      memo: { type: "string" },
      review_flag: { type: "boolean", description: "曖昧で要確認の場合true" },
      review_reason: { type: "string", description: "review_flagの理由" },
      confidence: { type: "number", description: "0-1の信頼度" }
    },
    required: ["is_transaction"]
  }
};
```

### 6.3 照会用プロンプト

```typescript
export const ANSWER_QUERY_SYSTEM = `
あなたは運用会社の帳簿アシスタントです。仲間からの質問に対して、提供されたデータをもとに正確に答えてください。

## 制約
- 提供されたデータ以外の情報は使わない
- 数字は ¥1,234,567 のような3桁区切りで表示
- FX損益は + / - の符号を明示
- 不明な場合は推測せず「データにありません」と答える
- 簡潔に。Telegramで読みやすい改行を入れる
- 個人を特定できる情報は質問者が仲間（members.role=member以上）でない場合は出さない

## 提供データ形式
- 全 active な transactions（最新N件 or 期間内）
- 集計値（残高・月次合計）
- categoriesマスタ
`;
```

照会フローでは、まず質問内容から「どのデータを取得すべきか」を判定し、Sheetsから必要なデータを引き、それをコンテキストにLLMが回答する2段階構成にする。

### 6.4 モデル戦略

```typescript
// lib/llm/client.ts
export async function callClaude(messages, tools?, systemPrompt?) {
  try {
    return await anthropic.messages.create({
      model: process.env.LLM_PRIMARY_MODEL,  // claude-opus-4-7
      max_tokens: 2048,
      system: systemPrompt,
      messages,
      tools
    });
  } catch (err) {
    console.error('[LLM] primary failed, falling back', err);
    return await anthropic.messages.create({
      model: process.env.LLM_FALLBACK_MODEL,  // claude-sonnet-4-6
      max_tokens: 2048,
      system: systemPrompt,
      messages,
      tools
    });
  }
}
```

---

## 7. Google Sheets 書き込みの注意点

### 7.1 同時編集の競合対策

Sheets API は楽観ロックがないので、同時書き込み時の上書きリスクがある。対策：

**Option A（推奨・シンプル）**: Telegram Webhook は単一プロセスで直列処理。Vercel関数なら通常問題なし。

**Option B（堅牢）**: Upstash Redis で `kumibooks:write_lock` キーを使った分散ロック。書き込み前に取得、完了で解放。タイムアウト10秒。

v1 は Option A で開始、頻度が上がったら B に切り替え。

### 7.2 ID 採番

- `id` は UUID v4 を Node.js 側で生成（`crypto.randomUUID()`）
- Sheets の行番号には依存しない（ユーザーが手動で並び替えても壊れないように）

### 7.3 論理削除

`status = 'deleted'` の行は集計から除外。**物理削除は禁止**（監査ログとの整合性が崩れる）。

### 7.4 数式の保護

`investors.total_deposited` などの数式セルは Cron / アプリから書き換えない。アプリは `transactions` への append のみ。残りは Sheets 側の数式で計算。

---

## 8. 月次レポート Cron 仕様

### 8.1 スケジュール

`vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/monthly-report", "schedule": "0 23 L * *" }
  ]
}
```
※ Vercel Cron は `L`（月末）非対応の場合があるため、毎月1日 0:05 JST（= UTC 15:05）に前月分を集計する形式に変更：

```json
{ "path": "/api/cron/monthly-report", "schedule": "5 15 1 * *" }
```

### 8.2 処理内容

1. 前月の `transactions` を全取得（status=active）
2. 集計（収入合計・経費合計・FX損益・入出金・純損益）
3. 投資家別の出資残高スナップショット
4. `monthly_summary` シートに1行追加
5. Telegramグループに整形したレポート投稿
6. レポート全文を Markdown で生成し、Telegramの「ファイル添付」で送信（長文対策）

### 8.3 レポートテンプレート

```
📊 ${YYYY年MM月} 運用レポート

【収支】
収入合計: ¥X,XXX,XXX
経費合計: ¥X,XXX,XXX
FX損益:  +¥X,XXX,XXX

純損益:   +¥X,XXX,XXX

【入出金】
出資受入: ¥X,XXX,XXX
分配・返金: ¥X,XXX,XXX

【月末残高】
合計: ¥X,XXX,XXX

【出資者別残高】
- 田中さん: ¥X,XXX,XXX
- 鈴木さん: ¥X,XXX,XXX

詳細: ${SHEETS_URL}
```

### 8.4 Cron認証

```typescript
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // ...
}
```

---

## 9. セキュリティ要件

1. **Telegram Webhook 認証**：URLにsecretクエリパラメータ + Telegram の `X-Telegram-Bot-Api-Secret-Token` ヘッダの両方検証
2. **メンバー検証**：全ての記帳・照会前に `members` シートで `tg_id` の active を確認
3. **グループID検証**：許可された `TELEGRAM_GROUP_ID` 以外のチャットからのメッセージは拒否
4. **環境変数の取り扱い**：`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` は絶対にログ出力しない
5. **Audit Log の不可逆性**：監査ログへの書き込み失敗時はトランザクションも中止（fail-closed）
6. **PII最小化**：投資家名は実名でも構わないが、メモ欄に銀行口座番号などを書かないようプロンプトで誘導
7. **Rate Limiting**：1ユーザー10msg/分を超える場合は警告（簡易実装でOK）

---

## 10. エラーハンドリング & UX

### 10.1 LLM抽出失敗時

```
仁さん、このメッセージから取引情報を抽出できませんでした。
以下のように記帳できます：

例: 「広告費5000円」「FX +3万円」「田中さんから50万入金」

または /help で詳細を確認してください。
```

### 10.2 review_flag が立った場合

確認メッセージで「これで合ってる？」と問い、ユーザーが ✅ を押すまで Sheets には書き込まない。pendingな状態は Vercel KV か Redis に一時保存（5分TTL）。

### 10.3 Sheets API エラー

3回までリトライ（指数バックオフ）→ 失敗したらユーザーに「記帳できませんでした、もう一度送ってください」と返信し、エラーをaudit_logに記録。

### 10.4 LLM両モデル失敗

両方のモデルが失敗した場合は「現在AIが応答できません。少し時間を置いて再度お試しください」と返答し、メッセージをqueueに保存（次回起動時にリトライ）。

---

## 11. 実装順序（開発スプリント）

Claude Code には以下の順番で実装を依頼すること：

### Sprint 1: 土台（半日）
1. プロジェクト初期化（Next.js 14 App Router + TypeScript + ESLint）
2. Google Sheets クライアント（読み書き基本）
3. 環境変数の型定義（zodで検証）
4. Telegram Bot 接続テスト（/whoami が動く）

### Sprint 2: 記帳機能（1日）
5. members 認証
6. LLM Function Calling で記帳パース
7. 確認メッセージのインラインボタン
8. transactions への書き込み + audit_log

### Sprint 3: 照会機能（半日）
9. /balance /today /month /list コマンド
10. 自然文の照会（「今月いくら使った？」）
11. /undo

### Sprint 4: 月次レポート（半日）
12. monthly レポート生成ロジック
13. Vercel Cron 設定
14. monthly_summary シート書き込み

### Sprint 5: 仕上げ（半日）
15. エラーハンドリング全体強化
16. README とセットアップガイド
17. 仁さん用の手動テストシナリオ作成

---

## 12. テストシナリオ（仁さん向け受け入れテスト）

実装後、以下を仁さんが手動で確認：

1. グループに「広告費5000円」と送信 → 確認メッセージ → ✅ → Sheets に1行追加 + audit_log
2. 「FX +3万」→ 同上、type=fx_pnl, category=fx_profit
3. 「田中さんから100万入金」→ counterparty=田中さん, type=deposit
4. `/balance` → 現在残高が返る
5. 「今月の利益は？」→ LLMが集計して回答
6. `/undo` → 自分の最後の記帳が status=deleted になる
7. 月初Cron発火 → Telegramに前月レポート投稿 + monthly_summary 1行追加
8. 非メンバーがメッセージ送信 → 無視される
9. Sheetsを直接編集 → アプリ側集計に反映される（LLM照会で正しい数字）

---

## 13. README に書くべきこと

- セットアップ手順（GCP Service Account作成、Sheets共有、Telegram Bot作成、Webhook登録）
- 環境変数の取得方法
- ローカル開発（`vercel dev` + ngrok）
- 本番デプロイ手順
- 仲間の追加方法（`members` シート編集）
- 投資家の追加方法（`investors` シート編集）
- カテゴリ追加方法
- トラブルシューティング（Webhookが効かない時、LLMがエラーを返す時、Sheetsが書けない時）
- データバックアップ推奨（Sheetsの「コピーを作成」を月初に）

---

## 14. 法的・実務的な注意（仁さんへ）

これは Claude Code 向けの仕様書ですが、人として一言：

外部投資家から金銭を集めて運用する形態は、規模・形態によっては金融商品取引法（適格機関投資家等特例業務、第二種金商業など）の対象になる可能性があります。本システムは記帳ツールであり、法的位置付けの整理は別途、金融に詳しい弁護士・税理士へ相談してください。本仕様書は法的助言ではありません。

帳簿は揉めごとを未然に防ぐ最強の道具です。仲間内だからこそ、最初に仕組みを作っておく仁さんの判断は正しいと思います。

---

## 15. v2 で検討する拡張

- 複数 wallet 対応
- 複数通貨の換算（FXレート自動取得）
- レシート画像 → OCR → 自動記帳
- Web ダッシュボード（Next.js 既にあるので追加コスト低）
- 投資家への自動レポート配信（個別の Telegram DM や メール）
- 会計ソフト（freee/マネフォ）への CSV エクスポート
- 税理士向けエクスポート（仕訳形式）

---

**仕様書作成者向け補足**：
この仕様書は仁さん（独立系開発者・起業家、Claude Code/Factory Droidに開発を委任する流儀）向けに最適化されています。実装中に判断に迷う箇所があれば、`review_flag` 同様にコメントで残し、仁さんに確認を仰ぐスタンスで進めてください。

以上。
