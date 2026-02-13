import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AnthropicProvider,
  OpenAIProvider,
  createProvider,
  resolveApiKey,
  formatAnthropicMessages,
  formatAnthropicTools,
  parseAnthropicResponse,
  mapAnthropicStopReason,
  formatOpenAIMessages,
  formatOpenAITools,
  parseOpenAIResponse,
  mapOpenAIFinishReason,
} from './llm-providers.js';
import type { LLMConfig, LLMMessage, LLMTool } from '../types/index.js';

// =============================================================================
// HELPERS
// =============================================================================

function makeConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    enabled: true,
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    apiKey: 'test-key-123',
    maxTokens: 4096,
    temperature: 0,
    ...overrides,
  };
}

function makeTools(): LLMTool[] {
  return [
    {
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  ];
}

function makeMessages(): LLMMessage[] {
  return [
    { role: 'system', content: 'You are Ralph.' },
    { role: 'user', content: 'Do the task.' },
    { role: 'assistant', content: 'I will read the file.' },
    { role: 'user', content: 'Go ahead.' },
  ];
}

function makeMockFetch(responseBody: unknown, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(responseBody),
    json: async () => responseBody,
  })) as unknown as typeof fetch;
}

// =============================================================================
// formatAnthropicMessages
// =============================================================================

describe('formatAnthropicMessages', () => {
  it('extracts system prompt from messages', () => {
    const messages = makeMessages();
    const { systemPrompt, apiMessages } = formatAnthropicMessages(messages);
    expect(systemPrompt).toBe('You are Ralph.');
    expect(apiMessages).toHaveLength(3);
    expect(apiMessages.every(m => m.role !== 'system')).toBe(true);
  });

  it('concatenates multiple system messages', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'Rule 1' },
      { role: 'system', content: 'Rule 2' },
      { role: 'user', content: 'Hi' },
    ];
    const { systemPrompt } = formatAnthropicMessages(messages);
    expect(systemPrompt).toBe('Rule 1\n\nRule 2');
  });

  it('returns undefined system prompt when no system messages', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Hi' },
    ];
    const { systemPrompt, apiMessages } = formatAnthropicMessages(messages);
    expect(systemPrompt).toBeUndefined();
    expect(apiMessages).toHaveLength(1);
  });

  it('preserves message order', () => {
    const messages = makeMessages();
    const { apiMessages } = formatAnthropicMessages(messages);
    expect(apiMessages[0].role).toBe('user');
    expect(apiMessages[1].role).toBe('assistant');
    expect(apiMessages[2].role).toBe('user');
  });

  it('handles empty message list', () => {
    const { systemPrompt, apiMessages } = formatAnthropicMessages([]);
    expect(systemPrompt).toBeUndefined();
    expect(apiMessages).toHaveLength(0);
  });
});

// =============================================================================
// formatAnthropicTools
// =============================================================================

describe('formatAnthropicTools', () => {
  it('converts parameters to input_schema', () => {
    const tools = makeTools();
    const result = formatAnthropicTools(tools);
    expect(result).toHaveLength(2);
    expect(result[0].input_schema).toEqual(tools[0].parameters);
    expect(result[0].name).toBe('read_file');
    expect(result[0].description).toBe('Read a file');
  });

  it('handles empty tool list', () => {
    expect(formatAnthropicTools([])).toEqual([]);
  });

  it('preserves all tool fields', () => {
    const tools = makeTools();
    const result = formatAnthropicTools(tools);
    for (let i = 0; i < tools.length; i++) {
      expect(result[i].name).toBe(tools[i].name);
      expect(result[i].description).toBe(tools[i].description);
    }
  });
});

// =============================================================================
// parseAnthropicResponse
// =============================================================================

describe('parseAnthropicResponse', () => {
  it('parses text-only response', () => {
    const data = {
      id: 'msg-1',
      type: 'message' as const,
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Hello world' }],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const result = parseAnthropicResponse(data);
    expect(result.content).toBe('Hello world');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.finishReason).toBe('stop');
  });

  it('parses tool_use response', () => {
    const data = {
      id: 'msg-2',
      type: 'message' as const,
      role: 'assistant' as const,
      content: [
        { type: 'text' as const, text: 'Let me read that.' },
        {
          type: 'tool_use' as const,
          id: 'call-1',
          name: 'read_file',
          input: { path: 'README.md' },
        },
      ],
      stop_reason: 'tool_use' as const,
      usage: { input_tokens: 10, output_tokens: 20 },
    };
    const result = parseAnthropicResponse(data);
    expect(result.content).toBe('Let me read that.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(result.toolCalls[0].arguments).toEqual({ path: 'README.md' });
    expect(result.finishReason).toBe('tool_calls');
  });

  it('handles multiple tool_use blocks', () => {
    const data = {
      id: 'msg-3',
      type: 'message' as const,
      role: 'assistant' as const,
      content: [
        { type: 'tool_use' as const, id: 'c1', name: 'read_file', input: { path: 'a.ts' } },
        { type: 'tool_use' as const, id: 'c2', name: 'read_file', input: { path: 'b.ts' } },
      ],
      stop_reason: 'tool_use' as const,
      usage: { input_tokens: 10, output_tokens: 20 },
    };
    const result = parseAnthropicResponse(data);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].arguments).toEqual({ path: 'a.ts' });
    expect(result.toolCalls[1].arguments).toEqual({ path: 'b.ts' });
  });

  it('handles empty content array', () => {
    const data = {
      id: 'msg-4',
      type: 'message' as const,
      role: 'assistant' as const,
      content: [],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 5, output_tokens: 0 },
    };
    const result = parseAnthropicResponse(data);
    expect(result.content).toBe('');
    expect(result.toolCalls).toHaveLength(0);
  });

  it('handles max_tokens stop reason', () => {
    const data = {
      id: 'msg-5',
      type: 'message' as const,
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Partial...' }],
      stop_reason: 'max_tokens' as const,
      usage: { input_tokens: 10, output_tokens: 4096 },
    };
    const result = parseAnthropicResponse(data);
    expect(result.finishReason).toBe('length');
  });

  it('handles tool_use with missing input', () => {
    const data = {
      id: 'msg-6',
      type: 'message' as const,
      role: 'assistant' as const,
      content: [
        { type: 'tool_use' as const, id: 'c1', name: 'task_complete' },
      ],
      stop_reason: 'tool_use' as const,
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const result = parseAnthropicResponse(data);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].arguments).toEqual({});
  });

  it('concatenates multiple text blocks', () => {
    const data = {
      id: 'msg-7',
      type: 'message' as const,
      role: 'assistant' as const,
      content: [
        { type: 'text' as const, text: 'Part 1. ' },
        { type: 'text' as const, text: 'Part 2.' },
      ],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    const result = parseAnthropicResponse(data);
    expect(result.content).toBe('Part 1. Part 2.');
  });
});

// =============================================================================
// mapAnthropicStopReason
// =============================================================================

describe('mapAnthropicStopReason', () => {
  it('maps end_turn to stop', () => {
    expect(mapAnthropicStopReason('end_turn')).toBe('stop');
  });

  it('maps stop_sequence to stop', () => {
    expect(mapAnthropicStopReason('stop_sequence')).toBe('stop');
  });

  it('maps tool_use to tool_calls', () => {
    expect(mapAnthropicStopReason('tool_use')).toBe('tool_calls');
  });

  it('maps max_tokens to length', () => {
    expect(mapAnthropicStopReason('max_tokens')).toBe('length');
  });

  it('maps null to stop', () => {
    expect(mapAnthropicStopReason(null)).toBe('stop');
  });

  it('maps unknown to stop', () => {
    expect(mapAnthropicStopReason('something_else')).toBe('stop');
  });
});

// =============================================================================
// AnthropicProvider constructor
// =============================================================================

describe('AnthropicProvider', () => {
  it('throws if no API key', () => {
    expect(() => new AnthropicProvider(makeConfig({ apiKey: undefined }))).toThrow(
      'Anthropic API key is required',
    );
  });

  it('uses default base URL', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    const provider = new AnthropicProvider(makeConfig(), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.anything(),
    );
  });

  it('uses custom base URL', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    const provider = new AnthropicProvider(
      makeConfig({ baseUrl: 'https://custom.api.com' }),
      mockFetch,
    );
    await provider.chat([{ role: 'user', content: 'Hi' }]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.api.com/v1/messages',
      expect.anything(),
    );
  });

  it('sends correct headers', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const provider = new AnthropicProvider(makeConfig(), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key-123');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends model and parameters in body', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const provider = new AnthropicProvider(
      makeConfig({ model: 'claude-3-haiku', maxTokens: 1024, temperature: 0.5 }),
      mockFetch,
    );
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.model).toBe('claude-3-haiku');
    expect(body.max_tokens).toBe(1024);
    expect(body.temperature).toBe(0.5);
  });

  it('includes system prompt in body', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const provider = new AnthropicProvider(makeConfig(), mockFetch);
    await provider.chat([
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hi' },
    ]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.system).toBe('Be helpful');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });

  it('omits system field when no system messages', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const provider = new AnthropicProvider(makeConfig(), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.system).toBeUndefined();
  });

  it('includes tools when provided', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const provider = new AnthropicProvider(makeConfig(), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }], makeTools());

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0].input_schema).toBeDefined();
    expect(body.tools[0].parameters).toBeUndefined();
  });

  it('omits tools when not provided', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const provider = new AnthropicProvider(makeConfig(), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.tools).toBeUndefined();
  });

  it('throws on API error with status and body', async () => {
    const mockFetch = makeMockFetch(
      { error: { type: 'invalid_request', message: 'Bad request' } },
      400,
    );
    const provider = new AnthropicProvider(makeConfig(), mockFetch);
    await expect(provider.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
      'Anthropic API error 400',
    );
  });

  it('parses full tool_use response', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Reading file.' },
        { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'test.ts' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 50, output_tokens: 30 },
    });
    const provider = new AnthropicProvider(makeConfig(), mockFetch);
    const result = await provider.chat(
      [{ role: 'user', content: 'Read the file' }],
      makeTools(),
    );
    expect(result.content).toBe('Reading file.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(result.toolCalls[0].arguments).toEqual({ path: 'test.ts' });
    expect(result.finishReason).toBe('tool_calls');
  });

  it('uses default model when not specified', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const provider = new AnthropicProvider(
      makeConfig({ model: '' }),
      mockFetch,
    );
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.model).toBe('claude-sonnet-4-5-20250929');
  });
});

// =============================================================================
// formatOpenAIMessages
// =============================================================================

describe('formatOpenAIMessages', () => {
  it('preserves all message roles including system', () => {
    const messages = makeMessages();
    const result = formatOpenAIMessages(messages);
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
    expect(result[2].role).toBe('assistant');
    expect(result[3].role).toBe('user');
  });

  it('preserves content', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'Hello world' }];
    const result = formatOpenAIMessages(messages);
    expect(result[0].content).toBe('Hello world');
  });

  it('handles empty list', () => {
    expect(formatOpenAIMessages([])).toEqual([]);
  });
});

// =============================================================================
// formatOpenAITools
// =============================================================================

describe('formatOpenAITools', () => {
  it('wraps tools in function format', () => {
    const tools = makeTools();
    const result = formatOpenAITools(tools);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('read_file');
    expect(result[0].function.description).toBe('Read a file');
    expect(result[0].function.parameters).toEqual(tools[0].parameters);
  });

  it('handles empty tool list', () => {
    expect(formatOpenAITools([])).toEqual([]);
  });
});

// =============================================================================
// parseOpenAIResponse
// =============================================================================

describe('parseOpenAIResponse', () => {
  it('parses text response', () => {
    const data = {
      id: 'chatcmpl-1',
      choices: [{
        index: 0,
        message: { role: 'assistant' as const, content: 'Hello!' },
        finish_reason: 'stop' as const,
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = parseOpenAIResponse(data);
    expect(result.content).toBe('Hello!');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.finishReason).toBe('stop');
  });

  it('parses tool_calls response', () => {
    const data = {
      id: 'chatcmpl-2',
      choices: [{
        index: 0,
        message: {
          role: 'assistant' as const,
          content: null,
          tool_calls: [{
            id: 'call-1',
            type: 'function' as const,
            function: {
              name: 'read_file',
              arguments: '{"path":"README.md"}',
            },
          }],
        },
        finish_reason: 'tool_calls' as const,
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
    const result = parseOpenAIResponse(data);
    expect(result.content).toBe('');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(result.toolCalls[0].arguments).toEqual({ path: 'README.md' });
    expect(result.finishReason).toBe('tool_calls');
  });

  it('handles multiple tool calls', () => {
    const data = {
      id: 'chatcmpl-3',
      choices: [{
        index: 0,
        message: {
          role: 'assistant' as const,
          content: 'Reading files.',
          tool_calls: [
            { id: 'c1', type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
            { id: 'c2', type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"b.ts"}' } },
          ],
        },
        finish_reason: 'tool_calls' as const,
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
    const result = parseOpenAIResponse(data);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.content).toBe('Reading files.');
  });

  it('handles empty choices', () => {
    const data = {
      id: 'chatcmpl-4',
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    const result = parseOpenAIResponse(data);
    expect(result.content).toBe('');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.finishReason).toBe('error');
  });

  it('handles malformed tool call arguments', () => {
    const data = {
      id: 'chatcmpl-5',
      choices: [{
        index: 0,
        message: {
          role: 'assistant' as const,
          content: null,
          tool_calls: [{
            id: 'call-1',
            type: 'function' as const,
            function: {
              name: 'read_file',
              arguments: 'not valid json{{{',
            },
          }],
        },
        finish_reason: 'tool_calls' as const,
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = parseOpenAIResponse(data);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].arguments).toEqual({});
  });

  it('handles null content', () => {
    const data = {
      id: 'chatcmpl-6',
      choices: [{
        index: 0,
        message: { role: 'assistant' as const, content: null },
        finish_reason: 'stop' as const,
      }],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    };
    const result = parseOpenAIResponse(data);
    expect(result.content).toBe('');
  });

  it('handles length finish reason', () => {
    const data = {
      id: 'chatcmpl-7',
      choices: [{
        index: 0,
        message: { role: 'assistant' as const, content: 'Truncated...' },
        finish_reason: 'length' as const,
      }],
      usage: { prompt_tokens: 10, completion_tokens: 4096, total_tokens: 4106 },
    };
    const result = parseOpenAIResponse(data);
    expect(result.finishReason).toBe('length');
  });

  it('handles content_filter finish reason', () => {
    const data = {
      id: 'chatcmpl-8',
      choices: [{
        index: 0,
        message: { role: 'assistant' as const, content: '' },
        finish_reason: 'content_filter' as const,
      }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    };
    const result = parseOpenAIResponse(data);
    expect(result.finishReason).toBe('error');
  });
});

// =============================================================================
// mapOpenAIFinishReason
// =============================================================================

describe('mapOpenAIFinishReason', () => {
  it('maps stop to stop', () => {
    expect(mapOpenAIFinishReason('stop')).toBe('stop');
  });

  it('maps tool_calls to tool_calls', () => {
    expect(mapOpenAIFinishReason('tool_calls')).toBe('tool_calls');
  });

  it('maps length to length', () => {
    expect(mapOpenAIFinishReason('length')).toBe('length');
  });

  it('maps content_filter to error', () => {
    expect(mapOpenAIFinishReason('content_filter')).toBe('error');
  });

  it('maps null to stop', () => {
    expect(mapOpenAIFinishReason(null)).toBe('stop');
  });

  it('maps unknown to stop', () => {
    expect(mapOpenAIFinishReason('unknown_reason')).toBe('stop');
  });
});

// =============================================================================
// OpenAIProvider
// =============================================================================

describe('OpenAIProvider', () => {
  it('throws if no API key', () => {
    expect(() => new OpenAIProvider(makeConfig({ provider: 'openai', apiKey: undefined }))).toThrow(
      'OpenAI API key is required',
    );
  });

  it('uses default base URL', async () => {
    const mockFetch = makeMockFetch({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });
    const provider = new OpenAIProvider(makeConfig({ provider: 'openai' }), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.anything(),
    );
  });

  it('uses custom base URL', async () => {
    const mockFetch = makeMockFetch({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });
    const provider = new OpenAIProvider(
      makeConfig({ provider: 'openai', baseUrl: 'https://my-proxy.com' }),
      mockFetch,
    );
    await provider.chat([{ role: 'user', content: 'Hi' }]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://my-proxy.com/v1/chat/completions',
      expect.anything(),
    );
  });

  it('sends Bearer authorization header', async () => {
    const mockFetch = makeMockFetch({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    const provider = new OpenAIProvider(makeConfig({ provider: 'openai' }), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key-123');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends model and parameters in body', async () => {
    const mockFetch = makeMockFetch({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    const provider = new OpenAIProvider(
      makeConfig({ provider: 'openai', model: 'gpt-4o-mini', maxTokens: 2048, temperature: 0.7 }),
      mockFetch,
    );
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.max_tokens).toBe(2048);
    expect(body.temperature).toBe(0.7);
  });

  it('keeps system messages in messages array', async () => {
    const mockFetch = makeMockFetch({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    const provider = new OpenAIProvider(makeConfig({ provider: 'openai' }), mockFetch);
    await provider.chat([
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hi' },
    ]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
  });

  it('includes tools in function format', async () => {
    const mockFetch = makeMockFetch({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    const provider = new OpenAIProvider(makeConfig({ provider: 'openai' }), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }], makeTools());

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('read_file');
  });

  it('omits tools when not provided', async () => {
    const mockFetch = makeMockFetch({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    const provider = new OpenAIProvider(makeConfig({ provider: 'openai' }), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.tools).toBeUndefined();
  });

  it('throws on API error', async () => {
    const mockFetch = makeMockFetch(
      { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } },
      429,
    );
    const provider = new OpenAIProvider(makeConfig({ provider: 'openai' }), mockFetch);
    await expect(provider.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
      'OpenAI API error 429',
    );
  });

  it('parses full tool_calls response', async () => {
    const mockFetch = makeMockFetch({
      id: 'chatcmpl-1',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'I will read it.',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"test.ts"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
    });
    const provider = new OpenAIProvider(makeConfig({ provider: 'openai' }), mockFetch);
    const result = await provider.chat(
      [{ role: 'user', content: 'Read the file' }],
      makeTools(),
    );
    expect(result.content).toBe('I will read it.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(result.toolCalls[0].arguments).toEqual({ path: 'test.ts' });
    expect(result.finishReason).toBe('tool_calls');
  });

  it('uses default model when not specified', async () => {
    const mockFetch = makeMockFetch({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    const provider = new OpenAIProvider(
      makeConfig({ provider: 'openai', model: '' }),
      mockFetch,
    );
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.model).toBe('gpt-4o');
  });
});

// =============================================================================
// resolveApiKey
// =============================================================================

describe('resolveApiKey', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns config as-is when apiKey is present', () => {
    const config = makeConfig({ apiKey: 'explicit-key' });
    expect(resolveApiKey(config).apiKey).toBe('explicit-key');
  });

  it('resolves ANTHROPIC_API_KEY from env', () => {
    process.env.ANTHROPIC_API_KEY = 'env-anthropic-key';
    const config = makeConfig({ apiKey: undefined, provider: 'anthropic' });
    expect(resolveApiKey(config).apiKey).toBe('env-anthropic-key');
  });

  it('resolves OPENAI_API_KEY from env', () => {
    process.env.OPENAI_API_KEY = 'env-openai-key';
    const config = makeConfig({ apiKey: undefined, provider: 'openai' });
    expect(resolveApiKey(config).apiKey).toBe('env-openai-key');
  });

  it('returns config unchanged for custom provider', () => {
    const config = makeConfig({ apiKey: undefined, provider: 'custom' });
    expect(resolveApiKey(config).apiKey).toBeUndefined();
  });

  it('returns config unchanged when env var not set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const config = makeConfig({ apiKey: undefined, provider: 'anthropic' });
    expect(resolveApiKey(config).apiKey).toBeUndefined();
  });

  it('does not mutate original config', () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';
    const config = makeConfig({ apiKey: undefined, provider: 'anthropic' });
    const resolved = resolveApiKey(config);
    expect(config.apiKey).toBeUndefined();
    expect(resolved.apiKey).toBe('env-key');
    expect(resolved).not.toBe(config);
  });
});

// =============================================================================
// createProvider
// =============================================================================

describe('createProvider', () => {
  it('creates AnthropicProvider for anthropic config', () => {
    const provider = createProvider(makeConfig({ provider: 'anthropic' }));
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('creates OpenAIProvider for openai config', () => {
    const provider = createProvider(makeConfig({ provider: 'openai' }));
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('throws for custom provider', () => {
    expect(() => createProvider(makeConfig({ provider: 'custom' }))).toThrow(
      'Custom provider requires an explicit factory function',
    );
  });

  it('throws for unknown provider', () => {
    expect(() => createProvider(makeConfig({ provider: 'gemini' as 'anthropic' }))).toThrow(
      'Unknown LLM provider: gemini',
    );
  });

  it('passes fetchFn to AnthropicProvider', async () => {
    const mockFetch = makeMockFetch({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const provider = createProvider(makeConfig({ provider: 'anthropic' }), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }]);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('passes fetchFn to OpenAIProvider', async () => {
    const mockFetch = makeMockFetch({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    const provider = createProvider(makeConfig({ provider: 'openai' }), mockFetch);
    await provider.chat([{ role: 'user', content: 'Hi' }]);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('resolves API key from env for anthropic', () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'from-env' };
    try {
      const provider = createProvider(makeConfig({ provider: 'anthropic', apiKey: undefined }));
      expect(provider).toBeInstanceOf(AnthropicProvider);
    } finally {
      process.env = originalEnv;
    }
  });

  it('resolves API key from env for openai', () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, OPENAI_API_KEY: 'from-env' };
    try {
      const provider = createProvider(makeConfig({ provider: 'openai', apiKey: undefined }));
      expect(provider).toBeInstanceOf(OpenAIProvider);
    } finally {
      process.env = originalEnv;
    }
  });
});
