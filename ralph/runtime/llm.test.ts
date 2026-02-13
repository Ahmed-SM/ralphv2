import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildSystemPrompt,
  buildIterationPrompt,
  executeToolCall,
  interpretResponse,
  executeLLMIteration,
  createLLMProvider,
  loadTaskContext,
  AGENT_TOOLS,
} from './llm.js';
import type { Executor } from './executor.js';
import type {
  Task,
  LLMProvider,
  LLMResponse,
  LLMToolCall,
  LLMConfig,
} from '../types/index.js';

// =============================================================================
// HELPERS
// =============================================================================

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: 'A test task description',
    status: 'in_progress',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMockExecutor(files: Record<string, string> = {}): Executor {
  const fs = new Map<string, string>(Object.entries(files));

  return {
    readFile: vi.fn(async (path: string) => {
      const content = fs.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      fs.set(path, content);
    }),
    bash: vi.fn(async (command: string) => {
      if (command === 'failing-command') {
        return { stdout: '', stderr: 'command failed', exitCode: 1 };
      }
      if (command === 'echo hello') {
        return { stdout: 'hello', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }),
    eval: vi.fn(async () => undefined),
    flush: vi.fn(async () => {}),
    rollback: vi.fn(() => {}),
    getPendingChanges: vi.fn(() => []),
    getSandbox: vi.fn(),
    _fs: fs,
  } as unknown as Executor & { _fs: Map<string, string> };
}

function makeMockLLMProvider(response: Partial<LLMResponse> = {}): LLMProvider {
  return {
    chat: vi.fn(async () => ({
      content: '',
      toolCalls: [],
      finishReason: 'stop' as const,
      ...response,
    })),
  };
}

function makeToolCall(name: string, args: Record<string, unknown> = {}): LLMToolCall {
  return { name, arguments: args };
}

// =============================================================================
// AGENT_TOOLS TESTS
// =============================================================================

describe('AGENT_TOOLS', () => {
  it('defines five tools', () => {
    expect(AGENT_TOOLS).toHaveLength(5);
  });

  it('includes read_file tool', () => {
    const tool = AGENT_TOOLS.find(t => t.name === 'read_file');
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toContain('path');
  });

  it('includes write_file tool', () => {
    const tool = AGENT_TOOLS.find(t => t.name === 'write_file');
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toContain('path');
    expect(tool!.parameters.required).toContain('content');
  });

  it('includes run_bash tool', () => {
    const tool = AGENT_TOOLS.find(t => t.name === 'run_bash');
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toContain('command');
  });

  it('includes task_complete tool', () => {
    const tool = AGENT_TOOLS.find(t => t.name === 'task_complete');
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toContain('artifacts');
  });

  it('includes task_blocked tool', () => {
    const tool = AGENT_TOOLS.find(t => t.name === 'task_blocked');
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toContain('blocker');
  });

  it('all tools have descriptions', () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});

// =============================================================================
// buildSystemPrompt TESTS
// =============================================================================

describe('buildSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('identifies as Ralph', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Ralph');
  });

  it('mentions sandbox', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('sandbox');
  });

  it('mentions task_complete', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('task_complete');
  });

  it('mentions task_blocked', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('task_blocked');
  });
});

// =============================================================================
// buildIterationPrompt TESTS
// =============================================================================

describe('buildIterationPrompt', () => {
  it('includes task ID and title', () => {
    const task = makeTask({ id: 'RALPH-042', title: 'Implement feature X' });
    const prompt = buildIterationPrompt(task, 1);
    expect(prompt).toContain('RALPH-042');
    expect(prompt).toContain('Implement feature X');
  });

  it('includes iteration number', () => {
    const task = makeTask();
    const prompt = buildIterationPrompt(task, 3);
    expect(prompt).toContain('3');
  });

  it('includes task status and type', () => {
    const task = makeTask({ status: 'in_progress', type: 'bug' });
    const prompt = buildIterationPrompt(task, 1);
    expect(prompt).toContain('in_progress');
    expect(prompt).toContain('bug');
  });

  it('includes description when present', () => {
    const task = makeTask({ description: 'Fix the login flow' });
    const prompt = buildIterationPrompt(task, 1);
    expect(prompt).toContain('Fix the login flow');
  });

  it('includes spec content when provided', () => {
    const task = makeTask();
    const prompt = buildIterationPrompt(task, 1, '# Spec\nDo the thing');
    expect(prompt).toContain('# Spec');
    expect(prompt).toContain('Do the thing');
  });

  it('includes agent instructions when provided', () => {
    const task = makeTask();
    const prompt = buildIterationPrompt(task, 1, undefined, 'Always write tests');
    expect(prompt).toContain('Always write tests');
  });

  it('includes previous result when provided', () => {
    const task = makeTask();
    const prompt = buildIterationPrompt(task, 2, undefined, undefined, 'File not found');
    expect(prompt).toContain('File not found');
    expect(prompt).toContain('Previous Iteration');
  });

  it('includes tags when present', () => {
    const task = makeTask({ tags: ['urgent', 'backend'] });
    const prompt = buildIterationPrompt(task, 1);
    expect(prompt).toContain('urgent');
    expect(prompt).toContain('backend');
  });

  it('omits optional sections when not provided', () => {
    const task = makeTask({ description: '', tags: undefined });
    const prompt = buildIterationPrompt(task, 1);
    expect(prompt).not.toContain('### Specification');
    expect(prompt).not.toContain('### Agent Instructions');
    expect(prompt).not.toContain('Previous Iteration');
    expect(prompt).not.toContain('**Tags:**');
  });

  it('ends with action instruction', () => {
    const task = makeTask();
    const prompt = buildIterationPrompt(task, 1);
    expect(prompt).toContain('task_complete');
    expect(prompt).toContain('task_blocked');
  });
});

// =============================================================================
// executeToolCall TESTS
// =============================================================================

describe('executeToolCall', () => {
  describe('read_file', () => {
    it('reads file successfully', async () => {
      const executor = makeMockExecutor({ './src/main.ts': 'console.log("hi")' });
      const toolCall = makeToolCall('read_file', { path: './src/main.ts' });

      const { action, output } = await executeToolCall(executor, toolCall);

      expect(action.type).toBe('read');
      expect(action.target).toBe('./src/main.ts');
      expect(output).toBe('console.log("hi")');
    });

    it('handles missing file', async () => {
      const executor = makeMockExecutor();
      const toolCall = makeToolCall('read_file', { path: './missing.ts' });

      const { action, output } = await executeToolCall(executor, toolCall);

      expect(action.type).toBe('read');
      expect(output).toContain('Error');
      expect(output).toContain('missing.ts');
    });

    it('records duration in action', async () => {
      const executor = makeMockExecutor({ './file.ts': 'content' });
      const toolCall = makeToolCall('read_file', { path: './file.ts' });

      const { action } = await executeToolCall(executor, toolCall);

      expect(action.duration).toBeGreaterThanOrEqual(0);
      expect(action.timestamp).toBeTruthy();
    });
  });

  describe('write_file', () => {
    it('writes file successfully', async () => {
      const executor = makeMockExecutor();
      const toolCall = makeToolCall('write_file', {
        path: './output.ts',
        content: 'export const x = 1;',
      });

      const { action, output } = await executeToolCall(executor, toolCall);

      expect(action.type).toBe('write');
      expect(action.target).toBe('./output.ts');
      expect(output).toContain('Successfully wrote');
      expect(output).toContain('19 bytes');
      expect(executor.writeFile).toHaveBeenCalledWith('./output.ts', 'export const x = 1;');
    });

    it('handles write error', async () => {
      const executor = makeMockExecutor();
      (executor.writeFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Permission denied')
      );
      const toolCall = makeToolCall('write_file', {
        path: './readonly.ts',
        content: 'data',
      });

      const { action, output } = await executeToolCall(executor, toolCall);

      expect(action.type).toBe('write');
      expect(output).toContain('Error');
      expect(output).toContain('Permission denied');
    });
  });

  describe('run_bash', () => {
    it('executes command successfully', async () => {
      const executor = makeMockExecutor();
      const toolCall = makeToolCall('run_bash', { command: 'echo hello' });

      const { action, output } = await executeToolCall(executor, toolCall);

      expect(action.type).toBe('bash');
      expect(action.target).toBe('echo hello');
      expect(output).toBe('hello');
    });

    it('reports command failure', async () => {
      const executor = makeMockExecutor();
      const toolCall = makeToolCall('run_bash', { command: 'failing-command' });

      const { action, output } = await executeToolCall(executor, toolCall);

      expect(action.type).toBe('bash');
      expect(output).toContain('Exit code 1');
      expect(output).toContain('command failed');
    });

    it('reports empty stdout as (no output)', async () => {
      const executor = makeMockExecutor();
      const toolCall = makeToolCall('run_bash', { command: 'silent-command' });

      const { output } = await executeToolCall(executor, toolCall);

      expect(output).toBe('(no output)');
    });

    it('handles bash execution error', async () => {
      const executor = makeMockExecutor();
      (executor.bash as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Sandbox timeout')
      );
      const toolCall = makeToolCall('run_bash', { command: 'hang' });

      const { action, output } = await executeToolCall(executor, toolCall);

      expect(action.type).toBe('bash');
      expect(output).toContain('Sandbox timeout');
    });
  });

  describe('task_complete', () => {
    it('returns completion signal', async () => {
      const executor = makeMockExecutor();
      const toolCall = makeToolCall('task_complete', {
        artifacts: ['./src/main.ts', './src/test.ts'],
        summary: 'Implemented feature',
      });

      const { action, output } = await executeToolCall(executor, toolCall);

      expect(action.type).toBe('eval');
      expect(action.target).toBe('task_complete');
      expect(output).toContain('Task declared complete');
      expect(output).toContain('./src/main.ts');
    });

    it('handles empty artifacts', async () => {
      const executor = makeMockExecutor();
      const toolCall = makeToolCall('task_complete', { artifacts: [] });

      const { output } = await executeToolCall(executor, toolCall);

      expect(output).toContain('Task declared complete');
    });
  });

  describe('task_blocked', () => {
    it('returns blocked signal', async () => {
      const executor = makeMockExecutor();
      const toolCall = makeToolCall('task_blocked', {
        blocker: 'Missing API credentials',
      });

      const { action, output } = await executeToolCall(executor, toolCall);

      expect(action.type).toBe('eval');
      expect(action.target).toBe('task_blocked');
      expect(output).toContain('Missing API credentials');
    });

    it('handles missing blocker description', async () => {
      const executor = makeMockExecutor();
      const toolCall = makeToolCall('task_blocked', {});

      const { output } = await executeToolCall(executor, toolCall);

      expect(output).toContain('Unknown blocker');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool', async () => {
      const executor = makeMockExecutor();
      const toolCall = makeToolCall('nonexistent_tool', {});

      const { action, output } = await executeToolCall(executor, toolCall);

      expect(action.type).toBe('eval');
      expect(output).toContain('Unknown tool');
      expect(output).toContain('nonexistent_tool');
    });
  });
});

// =============================================================================
// interpretResponse TESTS
// =============================================================================

describe('interpretResponse', () => {
  it('returns complete when task_complete was called', () => {
    const response: LLMResponse = {
      content: '',
      toolCalls: [],
      finishReason: 'tool_calls',
    };
    const toolCalls = [
      makeToolCall('read_file', { path: './src/main.ts' }),
      makeToolCall('task_complete', { artifacts: ['./out.ts'] }),
    ];

    const result = interpretResponse(response, toolCalls);

    expect(result.status).toBe('complete');
    if (result.status === 'complete') {
      expect(result.artifacts).toEqual(['./out.ts']);
    }
  });

  it('returns blocked when task_blocked was called', () => {
    const response: LLMResponse = {
      content: '',
      toolCalls: [],
      finishReason: 'tool_calls',
    };
    const toolCalls = [
      makeToolCall('task_blocked', { blocker: 'Missing dep' }),
    ];

    const result = interpretResponse(response, toolCalls);

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.blocker).toBe('Missing dep');
    }
  });

  it('returns failed on error finish reason', () => {
    const response: LLMResponse = {
      content: 'Rate limit exceeded',
      toolCalls: [],
      finishReason: 'error',
    };

    const result = interpretResponse(response, []);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('Rate limit');
    }
  });

  it('returns continue when LLM stops without actions', () => {
    const response: LLMResponse = {
      content: 'I need to think about this',
      toolCalls: [],
      finishReason: 'stop',
    };

    const result = interpretResponse(response, []);

    expect(result.status).toBe('continue');
    if (result.status === 'continue') {
      expect(result.reason).toContain('I need to think about this');
    }
  });

  it('returns continue when response truncated due to length', () => {
    const response: LLMResponse = {
      content: '',
      toolCalls: [],
      finishReason: 'length',
    };

    const result = interpretResponse(response, []);

    expect(result.status).toBe('continue');
    if (result.status === 'continue') {
      expect(result.reason).toContain('token limit');
    }
  });

  it('returns continue when tool calls made but no completion signal', () => {
    const response: LLMResponse = {
      content: 'Working on it',
      toolCalls: [],
      finishReason: 'tool_calls',
    };
    const toolCalls = [
      makeToolCall('read_file', { path: './src/main.ts' }),
      makeToolCall('write_file', { path: './src/out.ts', content: 'code' }),
    ];

    const result = interpretResponse(response, toolCalls);

    expect(result.status).toBe('continue');
    if (result.status === 'continue') {
      expect(result.reason).toContain('Working on it');
    }
  });

  it('prioritizes task_complete over other tool calls', () => {
    const response: LLMResponse = {
      content: '',
      toolCalls: [],
      finishReason: 'tool_calls',
    };
    const toolCalls = [
      makeToolCall('write_file', { path: './x.ts', content: 'x' }),
      makeToolCall('task_complete', { artifacts: ['./x.ts'] }),
      makeToolCall('read_file', { path: './y.ts' }),
    ];

    const result = interpretResponse(response, toolCalls);

    expect(result.status).toBe('complete');
  });

  it('prioritizes task_blocked over read/write calls', () => {
    const response: LLMResponse = {
      content: '',
      toolCalls: [],
      finishReason: 'tool_calls',
    };
    const toolCalls = [
      makeToolCall('read_file', { path: './missing.ts' }),
      makeToolCall('task_blocked', { blocker: 'API down' }),
    ];

    const result = interpretResponse(response, toolCalls);

    expect(result.status).toBe('blocked');
  });

  it('returns continue with default reason when content is empty', () => {
    const response: LLMResponse = {
      content: '',
      toolCalls: [],
      finishReason: 'stop',
    };

    const result = interpretResponse(response, []);

    expect(result.status).toBe('continue');
    if (result.status === 'continue') {
      expect(result.reason).toContain('stopped without actions');
    }
  });

  it('returns failed with default message on error with empty content', () => {
    const response: LLMResponse = {
      content: '',
      toolCalls: [],
      finishReason: 'error',
    };

    const result = interpretResponse(response, []);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('LLM returned an error');
    }
  });

  it('handles task_complete with missing artifacts gracefully', () => {
    const response: LLMResponse = {
      content: '',
      toolCalls: [],
      finishReason: 'tool_calls',
    };
    const toolCalls = [
      makeToolCall('task_complete', {}),
    ];

    const result = interpretResponse(response, toolCalls);

    expect(result.status).toBe('complete');
    if (result.status === 'complete') {
      expect(result.artifacts).toEqual([]);
    }
  });
});

// =============================================================================
// executeLLMIteration TESTS
// =============================================================================

describe('executeLLMIteration', () => {
  it('calls LLM with system and user messages', async () => {
    const provider = makeMockLLMProvider({ finishReason: 'stop', content: 'thinking' });
    const executor = makeMockExecutor();
    const task = makeTask();

    await executeLLMIteration(provider, executor, task, 1);

    expect(provider.chat).toHaveBeenCalledOnce();
    const [messages, tools] = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(tools).toEqual(AGENT_TOOLS);
  });

  it('includes spec content in prompt when provided', async () => {
    const provider = makeMockLLMProvider();
    const executor = makeMockExecutor();
    const task = makeTask();

    await executeLLMIteration(provider, executor, task, 1, {
      specContent: '# My Spec\nDo things',
    });

    const [messages] = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(messages[1].content).toContain('# My Spec');
  });

  it('executes tool calls from LLM response', async () => {
    const provider = makeMockLLMProvider({
      finishReason: 'tool_calls',
      toolCalls: [
        makeToolCall('read_file', { path: './src/main.ts' }),
        makeToolCall('task_complete', { artifacts: ['./src/main.ts'] }),
      ],
    });
    const executor = makeMockExecutor({ './src/main.ts': 'code' });
    const task = makeTask();

    const { result, actions } = await executeLLMIteration(provider, executor, task, 1);

    expect(result.status).toBe('complete');
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe('read');
    expect(actions[1].type).toBe('eval');
  });

  it('returns continue when LLM makes no completion call', async () => {
    const provider = makeMockLLMProvider({
      finishReason: 'tool_calls',
      toolCalls: [
        makeToolCall('read_file', { path: './src/main.ts' }),
      ],
      content: 'Still working',
    });
    const executor = makeMockExecutor({ './src/main.ts': 'code' });
    const task = makeTask();

    const { result } = await executeLLMIteration(provider, executor, task, 1);

    expect(result.status).toBe('continue');
  });

  it('returns blocked when LLM calls task_blocked', async () => {
    const provider = makeMockLLMProvider({
      finishReason: 'tool_calls',
      toolCalls: [
        makeToolCall('task_blocked', { blocker: 'Need database credentials' }),
      ],
    });
    const executor = makeMockExecutor();
    const task = makeTask();

    const { result } = await executeLLMIteration(provider, executor, task, 1);

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.blocker).toBe('Need database credentials');
    }
  });

  it('passes conversation history to LLM', async () => {
    const provider = makeMockLLMProvider();
    const executor = makeMockExecutor();
    const task = makeTask();
    const history = [
      { role: 'user' as const, content: 'prev prompt' },
      { role: 'assistant' as const, content: 'prev response' },
    ];

    await executeLLMIteration(provider, executor, task, 2, {
      conversationHistory: history,
    });

    const [messages] = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    // system + 2 history + current user = 4
    expect(messages).toHaveLength(4);
    expect(messages[1].content).toBe('prev prompt');
    expect(messages[2].content).toBe('prev response');
  });

  it('returns empty actions when no tool calls', async () => {
    const provider = makeMockLLMProvider({ finishReason: 'stop', content: 'thinking' });
    const executor = makeMockExecutor();
    const task = makeTask();

    const { actions } = await executeLLMIteration(provider, executor, task, 1);

    expect(actions).toHaveLength(0);
  });

  it('handles write_file tool call execution', async () => {
    const provider = makeMockLLMProvider({
      finishReason: 'tool_calls',
      toolCalls: [
        makeToolCall('write_file', { path: './out.ts', content: 'export const x = 1;' }),
        makeToolCall('task_complete', { artifacts: ['./out.ts'] }),
      ],
    });
    const executor = makeMockExecutor();
    const task = makeTask();

    const { result, actions } = await executeLLMIteration(provider, executor, task, 1);

    expect(result.status).toBe('complete');
    expect(actions).toHaveLength(2);
    expect(executor.writeFile).toHaveBeenCalledWith('./out.ts', 'export const x = 1;');
  });

  it('handles bash tool call execution', async () => {
    const provider = makeMockLLMProvider({
      finishReason: 'tool_calls',
      toolCalls: [
        makeToolCall('run_bash', { command: 'echo hello' }),
        makeToolCall('task_complete', { artifacts: [] }),
      ],
    });
    const executor = makeMockExecutor();
    const task = makeTask();

    const { result, actions } = await executeLLMIteration(provider, executor, task, 1);

    expect(result.status).toBe('complete');
    expect(actions[0].type).toBe('bash');
    expect(executor.bash).toHaveBeenCalledWith('echo hello');
  });
});

// =============================================================================
// createLLMProvider TESTS
// =============================================================================

describe('createLLMProvider', () => {
  it('returns null when config is undefined', () => {
    const result = createLLMProvider(undefined);
    expect(result).toBeNull();
  });

  it('returns null when LLM is not enabled', () => {
    const config: LLMConfig = {
      enabled: false,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 4096,
      temperature: 0,
    };
    const result = createLLMProvider(config);
    expect(result).toBeNull();
  });

  it('returns null when enabled but no factory provided', () => {
    const config: LLMConfig = {
      enabled: true,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 4096,
      temperature: 0,
    };
    const result = createLLMProvider(config);
    expect(result).toBeNull();
  });

  it('returns provider from factory when enabled', () => {
    const config: LLMConfig = {
      enabled: true,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 4096,
      temperature: 0,
    };
    const mockProvider = makeMockLLMProvider();
    const factory = vi.fn(() => mockProvider);

    const result = createLLMProvider(config, factory);

    expect(result).toBe(mockProvider);
    expect(factory).toHaveBeenCalledWith(config);
  });

  it('does not call factory when not enabled', () => {
    const config: LLMConfig = {
      enabled: false,
      provider: 'openai',
      model: 'gpt-4',
      maxTokens: 4096,
      temperature: 0,
    };
    const factory = vi.fn();

    createLLMProvider(config, factory);

    expect(factory).not.toHaveBeenCalled();
  });
});

// =============================================================================
// loadTaskContext TESTS
// =============================================================================

describe('loadTaskContext', () => {
  it('loads spec content when task has spec', async () => {
    const executor = makeMockExecutor({
      './specs/my-spec.md': '# My Spec\nDetails here',
    });
    const task = makeTask({ spec: './specs/my-spec.md' });

    const ctx = await loadTaskContext(executor, task);

    expect(ctx.specContent).toBe('# My Spec\nDetails here');
  });

  it('returns undefined specContent when spec file missing', async () => {
    const executor = makeMockExecutor();
    const task = makeTask({ spec: './specs/missing.md' });

    const ctx = await loadTaskContext(executor, task);

    expect(ctx.specContent).toBeUndefined();
  });

  it('returns undefined specContent when task has no spec', async () => {
    const executor = makeMockExecutor();
    const task = makeTask();
    delete task.spec;

    const ctx = await loadTaskContext(executor, task);

    expect(ctx.specContent).toBeUndefined();
  });

  it('loads agent instructions for task type', async () => {
    const executor = makeMockExecutor({
      './agents/task-discovery.md': '# Agent Instructions',
    });
    const task = makeTask({ type: 'task' });

    const ctx = await loadTaskContext(executor, task);

    expect(ctx.agentInstructions).toBe('# Agent Instructions');
  });

  it('loads agent instructions for bug type', async () => {
    const executor = makeMockExecutor({
      './agents/task-discovery.md': '# Bug Instructions',
    });
    const task = makeTask({ type: 'bug' });

    const ctx = await loadTaskContext(executor, task);

    expect(ctx.agentInstructions).toBe('# Bug Instructions');
  });

  it('returns undefined agentInstructions when agent file missing', async () => {
    const executor = makeMockExecutor();
    const task = makeTask({ type: 'task' });

    const ctx = await loadTaskContext(executor, task);

    expect(ctx.agentInstructions).toBeUndefined();
  });

  it('returns undefined agentInstructions for epic type (no agent mapping)', async () => {
    const executor = makeMockExecutor();
    const task = makeTask({ type: 'epic' });

    const ctx = await loadTaskContext(executor, task);

    expect(ctx.agentInstructions).toBeUndefined();
  });

  it('loads both spec and agent instructions', async () => {
    const executor = makeMockExecutor({
      './specs/feature.md': 'Feature spec',
      './agents/task-discovery.md': 'Agent notes',
    });
    const task = makeTask({ type: 'feature', spec: './specs/feature.md' });

    const ctx = await loadTaskContext(executor, task);

    expect(ctx.specContent).toBe('Feature spec');
    expect(ctx.agentInstructions).toBe('Agent notes');
  });
});

// =============================================================================
// INTEGRATION: executeIteration with LLM (via loop.ts)
// =============================================================================

describe('executeIteration with LLM provider', () => {
  it('uses LLM when provider is set on context', async () => {
    // Import executeIteration from loop to test the integration path
    const { executeIteration } = await import('./loop.js');

    const provider = makeMockLLMProvider({
      finishReason: 'tool_calls',
      toolCalls: [
        makeToolCall('task_complete', { artifacts: ['./done.ts'] }),
      ],
    });
    const executor = makeMockExecutor();
    const context = {
      config: {
        planFile: './plan.md',
        agentsFile: './AGENTS.md',
        loop: {
          maxIterationsPerTask: 10,
          maxTimePerTask: 60000,
          maxCostPerTask: 10,
          maxTasksPerRun: 50,
          maxTimePerRun: 300000,
          onFailure: 'continue' as const,
          parallelism: 1,
        },
        sandbox: { timeout: 5000, maxCommands: 10, cacheReads: false },
        tracker: {
          type: 'jira',
          configPath: './tracker.json',
          autoCreate: false,
          autoTransition: false,
          autoComment: false,
        },
        git: { autoCommit: false, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' },
        learning: { enabled: false, autoApplyImprovements: false, minConfidence: 0.8, retentionDays: 90 },
        notifications: { onAnomaly: false, onComplete: false, channel: 'console' as const },
      },
      executor,
      git: {} as any,
      workDir: '/tmp/test',
      llmProvider: provider,
    };
    const task = makeTask();

    const result = await executeIteration(context, task, 1);

    expect(result.status).toBe('complete');
    expect(provider.chat).toHaveBeenCalled();
  });

  it('falls back to heuristic when no LLM provider', async () => {
    const { executeIteration } = await import('./loop.js');

    const executor = makeMockExecutor({ './specs/my.md': '# Content' });
    const context = {
      config: {
        planFile: './plan.md',
        agentsFile: './AGENTS.md',
        loop: {
          maxIterationsPerTask: 10,
          maxTimePerTask: 60000,
          maxCostPerTask: 10,
          maxTasksPerRun: 50,
          maxTimePerRun: 300000,
          onFailure: 'continue' as const,
          parallelism: 1,
        },
        sandbox: { timeout: 5000, maxCommands: 10, cacheReads: false },
        tracker: {
          type: 'jira',
          configPath: './tracker.json',
          autoCreate: false,
          autoTransition: false,
          autoComment: false,
        },
        git: { autoCommit: false, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' },
        learning: { enabled: false, autoApplyImprovements: false, minConfidence: 0.8, retentionDays: 90 },
        notifications: { onAnomaly: false, onComplete: false, channel: 'console' as const },
      },
      executor,
      git: {} as any,
      workDir: '/tmp/test',
      // No llmProvider
    };
    const task = makeTask({ spec: './specs/my.md' });

    const result = await executeIteration(context, task, 1);

    // Heuristic: spec exists → complete
    expect(result.status).toBe('complete');
  });

  it('returns failed when LLM provider throws', async () => {
    const { executeIteration } = await import('./loop.js');

    const provider: LLMProvider = {
      chat: vi.fn(async () => { throw new Error('API key invalid'); }),
    };
    const executor = makeMockExecutor();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const context = {
      config: {
        planFile: './plan.md',
        agentsFile: './AGENTS.md',
        loop: {
          maxIterationsPerTask: 10,
          maxTimePerTask: 60000,
          maxCostPerTask: 10,
          maxTasksPerRun: 50,
          maxTimePerRun: 300000,
          onFailure: 'continue' as const,
          parallelism: 1,
        },
        sandbox: { timeout: 5000, maxCommands: 10, cacheReads: false },
        tracker: {
          type: 'jira',
          configPath: './tracker.json',
          autoCreate: false,
          autoTransition: false,
          autoComment: false,
        },
        git: { autoCommit: false, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' },
        learning: { enabled: false, autoApplyImprovements: false, minConfidence: 0.8, retentionDays: 90 },
        notifications: { onAnomaly: false, onComplete: false, channel: 'console' as const },
      },
      executor,
      git: {} as any,
      workDir: '/tmp/test',
      llmProvider: provider,
    };
    const task = makeTask();

    const result = await executeIteration(context, task, 1);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('API key invalid');
    }
  });
});
