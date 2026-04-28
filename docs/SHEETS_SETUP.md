# Google Sheets セットアップ

このドキュメントは、KumiBooks が必要とする 7 シートの **完全な列構成** とコピペ用の初期データをまとめたものです。仕様書 §2 と一致させてあります。

## 0. スプレッドシートの作成

1. Google Drive で新規スプレッドシートを作成（推奨名: `KumiBooks_Master`）
2. URLの `/spreadsheets/d/<長い文字列>/edit` の **長い文字列** が `GOOGLE_SHEETS_ID`
3. 右上「共有」→ Service Account のメールアドレス（`xxxx@xxxx.iam.gserviceaccount.com`）を **編集者** として追加
4. 既存の「シート1」を削除し、以下の 7 シートを順に作成

## 1. `transactions`

メインの取引履歴テーブル。1行目をそのままコピペしてください。

| 列 | ヘッダー |
|---|---------|
| A | `id` |
| B | `created_at` |
| C | `tx_date` |
| D | `type` |
| E | `amount` |
| F | `currency` |
| G | `category` |
| H | `counterparty` |
| I | `memo` |
| J | `recorded_by_tg_id` |
| K | `recorded_by_name` |
| L | `source_message` |
| M | `status` |
| N | `deleted_at` |
| O | `deleted_by` |
| P | `review_flag` |

**A1:P1** のヘッダー行（タブ区切り、Sheets にそのまま貼り付け可能）：

```
id	created_at	tx_date	type	amount	currency	category	counterparty	memo	recorded_by_tg_id	recorded_by_name	source_message	status	deleted_at	deleted_by	review_flag
```

> アプリは `transactions!A:A` 以降に append します。E列を「数値」、C列を「日付（YYYY-MM-DD 平文でも可）」、M列を「テキスト」にしておくと閲覧しやすい。

## 2. `investors`

| 列 | ヘッダー |
|---|---------|
| A | `id` |
| B | `name` |
| C | `tg_id` |
| D | `role` |
| E | `total_deposited` |
| F | `total_withdrawn` |
| G | `current_share` |
| H | `share_ratio` |
| I | `notes` |
| J | `joined_at` |

ヘッダー行：

```
id	name	tg_id	role	total_deposited	total_withdrawn	current_share	share_ratio	notes	joined_at
```

> `total_deposited` 等は手動でも数式 (`=SUMIFS(transactions!E:E, transactions!H:H, B2, transactions!D:D, "deposit", transactions!M:M, "active")`) でもOK。Sprint 4 の月次レポートはこのシートを **読むだけ** で、自前で counterparty を集計するため数式が空でも動きます。

サンプル行：

```
inv_tanaka	田中太郎	123456789	investor				0.30	2026年初出資	2026-01-15
inv_jin	仁	987654321	partner				0.50	代表	2026-01-01
```

## 3. `categories`

| 列 | ヘッダー |
|---|---------|
| A | `category_id` |
| B | `category_name` |
| C | `tx_type` |
| D | `description` |

ヘッダー行：

```
category_id	category_name	tx_type	description
```

仕様書 §2.3 の初期 10 行（タブ区切り、A2 から貼り付け）：

```
fx_profit	FX利益	fx_pnl	FX運用利益
fx_loss	FX損失	fx_pnl	FX運用損失
ad_cost	広告費	expense	広告・マーケ費用
tool_subscription	ツール費	expense	SaaS等
server_cost	サーバー費	expense	VPS等
biz_revenue	事業収入	income	FX以外の事業利益
investor_in	投資家入金	deposit	出資受入
investor_out	投資家出金	withdrawal	投資家への分配
internal_xfer	内部移動	transfer	口座間移動
misc_expense	その他経費	expense	分類困難なもの
```

> このシートは LLM のプロンプトに動的注入されるので、追加・編集はそのまま AI の解釈に反映される（5分キャッシュ）。

## 4. `wallets`

v1 では参照されないが、列構成だけ作成しておくと v2 への移行が楽。

```
wallet_id	wallet_name	currency	type	balance	notes
```

サンプル：

```
wallet_xm	XM Trading	JPY	fx			
wallet_jpybank	三菱UFJ	JPY	bank			
```

## 5. `monthly_summary`

```
year_month	total_income	total_expense	fx_pnl_net	net_profit	deposits_in	withdrawals_out	balance_eom	report_url
```

> Sprint 4 の cron が毎月1日朝に1行 append する。手動で行を入れても問題ない。

## 6. `audit_log`

```
log_id	timestamp	actor_tg_id	actor_name	action	target_table	target_id	before_value	after_value	source
```

> 全ての書き込み操作の前にここへ append される（fail-closed）。物理削除しないこと。

## 7. `members`

```
tg_id	name	role	active	joined_at
```

**最低 1 行必要**: 自分のtg_idを `active=TRUE` で登録しないとBotが誰の記帳も受け付けない。

```
123456789	仁	admin	TRUE	2026-04-28
```

> 自分の tg_id は Bot にメッセージを送って `/whoami` で取得できる。`/whoami` は未登録ユーザーにも応答する例外コマンド（§Sprint 1の意図的な設計）。

## チェックリスト

- [ ] スプレッドシートに 7 シートが揃っている
- [ ] 各シートの 1 行目に上記ヘッダーが完全に入っている（列順・スペル）
- [ ] `categories` に最低限の 10 行が入っている
- [ ] `members` に自分の tg_id が `active=TRUE` で入っている
- [ ] スプレッドシートが Service Account のメールアドレスに **編集者** として共有されている
- [ ] `GOOGLE_SHEETS_ID` を `.env.local` に設定した
