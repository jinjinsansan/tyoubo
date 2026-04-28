import type Anthropic from '@anthropic-ai/sdk';
import { TX_TYPES } from '@/types/transaction';

export interface CategoryRow {
  categoryId: string;
  categoryName: string;
  txType: string;
  description: string;
}

export const RECORD_TRANSACTION_TOOL: Anthropic.Tool = {
  name: 'record_transaction',
  description:
    '仲間からの自然文メッセージから取引情報を抽出して構造化データとして記録します。' +
    '質問・雑談・記帳でないメッセージの場合は is_transaction=false を返してください。',
  input_schema: {
    type: 'object',
    properties: {
      is_transaction: {
        type: 'boolean',
        description: 'メッセージが取引記帳に該当する場合 true。質問や雑談なら false。'
      },
      tx_date: {
        type: 'string',
        description:
          '取引発生日（YYYY-MM-DD）。明示がなければ基準日（今日）を入れる。'
      },
      type: {
        type: 'string',
        enum: [...TX_TYPES],
        description:
          'income=別事業収入 / expense=経費 / fx_pnl=FX損益 / deposit=投資家入金 / withdrawal=投資家分配 / transfer=口座間移動'
      },
      amount: {
        type: 'number',
        description: '金額の絶対値（正の数）。FX損失でも負の数にしないこと。'
      },
      currency: {
        type: 'string',
        description: 'JPY / USD / EUR など。明示がなければ JPY。'
      },
      category: {
        type: 'string',
        description: 'カテゴリマスタの category_id。例: fx_profit, ad_cost, biz_revenue'
      },
      counterparty: {
        type: 'string',
        description: '取引先・関係者名（任意）。投資家入出金の場合は必須。'
      },
      memo: {
        type: 'string',
        description: '補足メモ（任意）'
      },
      review_flag: {
        type: 'boolean',
        description: '抽出に曖昧さや要確認点があれば true'
      },
      review_reason: {
        type: 'string',
        description: 'review_flag を立てた理由'
      },
      confidence: {
        type: 'number',
        description: '抽出結果の信頼度 0.0〜1.0'
      }
    },
    required: ['is_transaction']
  }
};

/**
 * Render the categories block for the system prompt.
 */
export function renderCategoriesList(categories: CategoryRow[]): string {
  if (categories.length === 0) {
    return '(カテゴリマスタが空。仁さんに通知してください)';
  }
  return categories
    .map(
      (c) =>
        `- ${c.categoryId} (${c.categoryName}) → type=${c.txType}: ${c.description}`
    )
    .join('\n');
}

export interface BuildSystemPromptInput {
  todayJst: string;
  categories: CategoryRow[];
}

/**
 * §6.1 of the spec, plus practical guardrails.
 * The prompt is short — Opus 4.7's 4096-token caching minimum means we
 * won't get cache hits, but we mark with cache_control anyway for forward
 * compatibility (a no-op when below threshold).
 */
export function buildParseTransactionSystem(
  input: BuildSystemPromptInput
): string {
  return `あなたは少額運用会社「KumiBooks」の帳簿アシスタントです。仲間からの自然文メッセージを解析し、取引データに構造化してください。

## あなたの役割
- メッセージから取引情報を抽出して record_transaction ツールを呼ぶ
- 曖昧な部分は推測せず review_flag=true を立てる（理由を review_reason に書く）
- 質問・雑談・記帳でないものは is_transaction=false で返す

## 利用可能なカテゴリ
${renderCategoriesList(input.categories)}

## 日付の解釈（基準日: ${input.todayJst} JST）
- 「今日」→ 基準日
- 「昨日」→ 基準日 -1
- 「先週月曜」「先月末」など曖昧な相対表現は具体日に変換できる場合のみ採用、できなければ review_flag=true
- 明示がなければ tx_date = 基準日

## 通貨
- 「ドル」「USD」「$」→ USD
- 「ユーロ」「EUR」「€」→ EUR
- 言及なし → JPY

## type 判定
- 「FX 利益/プラス/勝ち」→ fx_pnl, category=fx_profit
- 「FX 損失/マイナス/負け」→ fx_pnl, category=fx_loss（amount は絶対値）
- 「広告費 / 広告」→ expense, category=ad_cost
- 「サーバー / サーバ代 / VPS」→ expense, category=server_cost
- 「ツール / SaaS / 月額 / サブスク」→ expense, category=tool_subscription
- 「事業収入 / 売上 / 案件報酬」→ income, category=biz_revenue
- 「(人名)から (金額) 入金」→ deposit, category=investor_in, counterparty=人名
- 「(人名)へ (金額) 分配/送金/返金」→ withdrawal, category=investor_out, counterparty=人名
- 「口座間移動 / 振替」→ transfer, category=internal_xfer
- 上記に該当しない経費 → expense, category=misc_expense, review_flag=true

## 金額
- 「3万」「3万円」→ 30000
- 「+5000」「-5000」→ 絶対値 5000（符号は type/category に反映）
- 数値が読み取れなければ review_flag=true

## 必ず record_transaction ツールを1回だけ呼んで結果を返してください。`;
}
