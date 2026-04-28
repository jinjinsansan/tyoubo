import type Anthropic from '@anthropic-ai/sdk';
import { callClaude, extractToolUse } from './client';
import {
  buildParseTransactionSystem,
  RECORD_TRANSACTION_TOOL
} from './prompts';
import { listCategories } from '@/lib/sheets/categories';
import { todayJst } from '@/lib/utils/id';
import { createLogger } from '@/lib/utils/logger';
import type { ParsedTransaction } from '@/types/transaction';

const log = createLogger('parse-tx');

export interface ParseResult {
  parsed: ParsedTransaction;
  rawText?: string;
  usage: { input: number; output: number };
}

export async function parseTransaction(
  userMessage: string
): Promise<ParseResult> {
  const categories = await listCategories();
  const system = buildParseTransactionSystem({
    todayJst: todayJst(),
    categories
  });

  // cache_control on the system block — no-op below 4096 tokens on Opus 4.7
  // but harmless and keeps the door open for future prompt growth.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } }
  ];

  const msg = await callClaude({
    max_tokens: 1024,
    system: systemBlocks,
    tools: [RECORD_TRANSACTION_TOOL],
    tool_choice: { type: 'tool', name: 'record_transaction' },
    messages: [{ role: 'user', content: userMessage }]
  });

  const tool = extractToolUse<ParsedTransaction>(msg, 'record_transaction');
  if (!tool) {
    log.warn('model did not call record_transaction tool', {
      stop_reason: msg.stop_reason
    });
    return {
      parsed: { is_transaction: false },
      usage: {
        input: msg.usage.input_tokens,
        output: msg.usage.output_tokens
      }
    };
  }

  log.info('parsed', {
    is_tx: tool.input.is_transaction,
    type: tool.input.type,
    amount: tool.input.amount,
    review: tool.input.review_flag,
    confidence: tool.input.confidence,
    cache_read: msg.usage.cache_read_input_tokens ?? 0
  });

  return {
    parsed: tool.input,
    usage: {
      input: msg.usage.input_tokens,
      output: msg.usage.output_tokens
    }
  };
}
