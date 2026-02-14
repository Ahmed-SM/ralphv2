/**
 * Concrete LLM Provider Implementations
 *
 * HTTP clients for Anthropic Messages API and OpenAI Chat Completions API.
 * Uses native fetch (Node 20+) — no external SDK dependencies.
 *
 * Providers translate between Ralph's LLM types and each vendor's API format.
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMResponse,
  LLMToolCall,
  LLMUsage,
  LLMConfig,
} from '../types/index.js';

// =============================================================================
// ANTHROPIC PROVIDER
// =============================================================================

/** Anthropic Messages API message format */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Anthropic Messages API provider.
 *
 * Converts Ralph LLM types to/from Anthropic's format:
 * - System prompt → top-level `system` field (not in messages)
 * - Tools → `input_schema` instead of `parameters`
 * - Response content blocks → text + tool_use parsed into LLMResponse
 */
export class AnthropicProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: LLMConfig, fetchFn?: typeof fetch) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required (set llm.apiKey or ANTHROPIC_API_KEY)');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    this.model = config.model || 'claude-sonnet-4-5-20250929';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature ?? 0;
    this.fetchFn = fetchFn || globalThis.fetch;
  }

  async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    const { systemPrompt, apiMessages } = formatAnthropicMessages(messages);
    const apiTools = tools ? formatAnthropicTools(tools) : undefined;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: apiMessages,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (apiTools && apiTools.length > 0) {
      body.tools = apiTools;
    }

    const response = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    return parseAnthropicResponse(data);
  }
}

/**
 * Extract system prompt from messages and convert remaining to Anthropic format.
 * System messages go into a separate `system` field, not the messages array.
 */
export function formatAnthropicMessages(messages: LLMMessage[]): {
  systemPrompt: string | undefined;
  apiMessages: AnthropicMessage[];
} {
  let systemPrompt: string | undefined;
  const apiMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Concatenate multiple system messages
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
    } else {
      apiMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  return { systemPrompt, apiMessages };
}

/**
 * Convert Ralph tool definitions to Anthropic format.
 * `parameters` → `input_schema`
 */
export function formatAnthropicTools(tools: LLMTool[]): AnthropicTool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Record<string, unknown>,
  }));
}

/**
 * Parse Anthropic response into Ralph's LLMResponse format.
 */
export function parseAnthropicResponse(data: AnthropicResponse): LLMResponse {
  let content = '';
  const toolCalls: LLMToolCall[] = [];

  for (const block of data.content) {
    if (block.type === 'text' && block.text) {
      content += block.text;
    } else if (block.type === 'tool_use' && block.name) {
      toolCalls.push({
        name: block.name,
        arguments: (block.input as Record<string, unknown>) || {},
      });
    }
  }

  const finishReason = mapAnthropicStopReason(data.stop_reason);

  const usage: LLMUsage | undefined = data.usage
    ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
    : undefined;

  return { content, toolCalls, finishReason, usage };
}

/**
 * Map Anthropic stop_reason to Ralph's finishReason.
 */
export function mapAnthropicStopReason(
  stopReason: string | null,
): LLMResponse['finishReason'] {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    default:
      return 'stop';
  }
}

// =============================================================================
// OPENAI PROVIDER
// =============================================================================

/** OpenAI Chat Completions API message format */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * OpenAI Chat Completions API provider.
 *
 * Converts Ralph LLM types to/from OpenAI's format:
 * - System prompt stays in messages as role:system
 * - Tools wrapped in { type: 'function', function: { ... } }
 * - tool_calls[].function.arguments is a JSON string, parsed back
 */
export class OpenAIProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: LLMConfig, fetchFn?: typeof fetch) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required (set llm.apiKey or OPENAI_API_KEY)');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com';
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature ?? 0;
    this.fetchFn = fetchFn || globalThis.fetch;
  }

  async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    const apiMessages = formatOpenAIMessages(messages);
    const apiTools = tools ? formatOpenAITools(tools) : undefined;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: apiMessages,
    };

    if (apiTools && apiTools.length > 0) {
      body.tools = apiTools;
    }

    const response = await this.fetchFn(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    return parseOpenAIResponse(data);
  }
}

/**
 * Convert Ralph messages to OpenAI format (pass-through since formats match).
 */
export function formatOpenAIMessages(messages: LLMMessage[]): OpenAIMessage[] {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));
}

/**
 * Convert Ralph tool definitions to OpenAI format.
 * Wraps each tool in { type: 'function', function: { ... } }
 */
export function formatOpenAITools(tools: LLMTool[]): OpenAITool[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  }));
}

/**
 * Parse OpenAI response into Ralph's LLMResponse format.
 */
export function parseOpenAIResponse(data: OpenAIResponse): LLMResponse {
  if (!data.choices || data.choices.length === 0) {
    return { content: '', toolCalls: [], finishReason: 'error' };
  }

  const choice = data.choices[0];
  const content = choice.message.content || '';
  const toolCalls: LLMToolCall[] = [];

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // Malformed JSON from LLM — treat as empty args
        args = {};
      }
      toolCalls.push({
        name: tc.function.name,
        arguments: args,
      });
    }
  }

  const finishReason = mapOpenAIFinishReason(choice.finish_reason);

  const usage: LLMUsage | undefined = data.usage
    ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
    : undefined;

  return { content, toolCalls, finishReason, usage };
}

/**
 * Map OpenAI finish_reason to Ralph's finishReason.
 */
export function mapOpenAIFinishReason(
  finishReason: string | null,
): LLMResponse['finishReason'] {
  switch (finishReason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'error';
    default:
      return 'stop';
  }
}

// =============================================================================
// PROVIDER FACTORY
// =============================================================================

/**
 * Create a concrete LLM provider from configuration.
 *
 * Supports:
 * - 'anthropic' → AnthropicProvider (Anthropic Messages API)
 * - 'openai' → OpenAIProvider (OpenAI Chat Completions API)
 * - 'custom' → requires explicit factory function
 *
 * API keys can be provided via config or environment variables:
 * - Anthropic: ANTHROPIC_API_KEY
 * - OpenAI: OPENAI_API_KEY
 */
export function createProvider(
  config: LLMConfig,
  fetchFn?: typeof fetch,
): LLMProvider {
  // Resolve API key from env if not in config
  const resolvedConfig = resolveApiKey(config);

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(resolvedConfig, fetchFn);
    case 'openai':
      return new OpenAIProvider(resolvedConfig, fetchFn);
    case 'custom':
      throw new Error('Custom provider requires an explicit factory function');
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

/**
 * Resolve API key from environment variables if not explicitly set in config.
 */
export function resolveApiKey(config: LLMConfig): LLMConfig {
  if (config.apiKey) return config;

  const envVarMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
  };

  const envVar = envVarMap[config.provider];
  if (envVar && process.env[envVar]) {
    return { ...config, apiKey: process.env[envVar] };
  }

  return config;
}
