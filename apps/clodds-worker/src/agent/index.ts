/**
 * Agent - Claude API integration with tool calling
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../config';
import type { User, ConversationMessage } from '../types';
import { TOOLS } from './tools';
import { executeTool, type ToolContext } from './executor';
import { SYSTEM_PROMPT } from './prompt';

const MAX_TOOL_ITERATIONS = 5;
const MODEL = 'claude-sonnet-4-20250514';

export interface AgentResponse {
  text: string;
  toolsUsed: string[];
}

export async function handleMessage(
  message: string,
  history: ConversationMessage[],
  user: User,
  env: Env
): Promise<AgentResponse> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Build messages array from history
  const messages: Anthropic.MessageParam[] = history.map((h) => ({
    role: h.role,
    content: h.content,
  }));

  // Add current message
  messages.push({ role: 'user', content: message });

  const toolContext: ToolContext = { env, user };
  const toolsUsed: string[] = [];

  let iteration = 0;
  let finalResponse = '';

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    // Check if we have tool calls
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    // If no tool calls, extract text and finish
    if (toolUseBlocks.length === 0) {
      finalResponse = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      break;
    }

    // Execute tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      toolsUsed.push(toolUse.name);

      const result = await executeTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        toolContext
      );

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result.success ? result.result : { error: result.error }),
        is_error: !result.success,
      });
    }

    // Add assistant message with tool uses
    messages.push({
      role: 'assistant',
      content: response.content,
    });

    // Add tool results
    messages.push({
      role: 'user',
      content: toolResults,
    });

    // If stop reason is end_turn, we're done after this iteration
    if (response.stop_reason === 'end_turn') {
      finalResponse = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      break;
    }
  }

  return {
    text: finalResponse || 'I apologize, but I was unable to complete your request.',
    toolsUsed,
  };
}

// Simpler single-turn handler for quick responses
export async function handleSimpleMessage(
  message: string,
  env: Env
): Promise<string> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: message }],
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}
