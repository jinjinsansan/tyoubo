import type Anthropic from '@anthropic-ai/sdk';
import { callClaude, extractText } from './client';
import { listActiveTransactions } from '@/lib/sheets/transactions';
import {
  computeBalance,
  computeMonthly,
  currentYearMonthJst
} from '@/lib/reports/aggregate';
import { todayJst } from '@/lib/utils/id';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('answer-query');

export const ANSWER_QUERY_SYSTEM = `あなたは少額運用会社「KumiBooks」の帳簿アシスタントです。仲間からの質問に対して、提供されたデータをもとに正確に答えてください。

## 制約
- 提供された data セクション以外の情報は使わない
- 数値は ¥1,234,567 のような3桁区切りで表示（円の場合）
- FX損益は + / - の符号を明示
- 提供データに含まれない期間や項目は「データにありません」と答える
- 自分で計算するな。balance/current_month 等の集計値はそのまま使う
- transactions セクションの数値の合計を出すような算術は避ける（ズレるため）
- 簡潔に。Telegramで読みやすい改行を入れる
- 装飾は最小限。Markdownの **太字** は使わず、見出しは行頭に🪙等の絵文字で代用してよい

## 回答形式
- 質問が日付・金額・件数なら直接答える
- 「今月の利益」のような集計質問なら current_month の数値を引用
- 雑談なら短く返す`;

export interface AnswerQueryResult {
  answer: string;
  usage: { input: number; output: number };
}

const MAX_TX_FOR_CONTEXT = 80;

interface AnswerContext {
  today: string;
  current_year_month: string;
  balance: ReturnType<typeof computeBalance>;
  current_month: ReturnType<typeof computeMonthly>;
  recent_transactions: Array<{
    date: string;
    type: string;
    amount: number;
    currency: string;
    category: string;
    counterparty: string;
    memo: string;
    recorded_by: string;
  }>;
}

export async function answerQuery(userText: string): Promise<AnswerQueryResult> {
  const all = await listActiveTransactions();
  const ym = currentYearMonthJst();
  const balance = computeBalance(all);
  const current_month = computeMonthly(all, ym);

  // Newest first, capped. Drops the source_message field — it can be long
  // and isn't needed for answering aggregate questions. If a user asks
  // about a specific entry, the LLM has enough context (date + counterparty
  // + memo) to identify it.
  const recent = all
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_TX_FOR_CONTEXT)
    .map((t) => ({
      date: t.txDate,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      category: t.category,
      counterparty: t.counterparty,
      memo: t.memo,
      recorded_by: t.recordedByName
    }));

  const ctx: AnswerContext = {
    today: todayJst(),
    current_year_month: ym,
    balance,
    current_month,
    recent_transactions: recent
  };

  const userContent = `## data\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\n## 質問\n${userText}`;

  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: ANSWER_QUERY_SYSTEM,
      cache_control: { type: 'ephemeral' }
    }
  ];

  const msg = await callClaude({
    max_tokens: 1024,
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }]
  });

  const text = extractText(msg).trim();
  log.info('answered', {
    tx_count: recent.length,
    cache_read: msg.usage.cache_read_input_tokens ?? 0,
    output_tokens: msg.usage.output_tokens
  });

  return {
    answer: text || 'うまく回答できませんでした。もう一度お試しください。',
    usage: {
      input: msg.usage.input_tokens,
      output: msg.usage.output_tokens
    }
  };
}
