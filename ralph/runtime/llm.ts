/**
 * LLM Integration - The brain of Ralph
 *
 * Provides:
 * - LLM provider abstraction (injectable for testing)
 * - Prompt construction from task context
 * - Tool definitions for sandbox actions
 * - Response parsing into IterationResult
 * - Action execution in sandbox
 */

import type {
  Task,
  Action,
  IterationResult,
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMToolCall,
  LLMResponse,
  LLMConfig,
} from '../types/index.js';
import type { Executor } from './executor.js';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

/**
 * Tools available to the LLM during task execution.
 * These map to sandbox actions (read, write, bash, eval).
 */
export const AGENT_TOOLS: LLMTool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace. Creates the file if it does not exist.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_bash',
    description: 'Execute a bash command in the sandboxed environment',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'task_complete',
    description: 'Declare the task as complete with a list of artifacts produced',
    parameters: {
      type: 'object',
      properties: {
        artifacts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths to files produced or modified',
        },
        summary: { type: 'string', description: 'Brief summary of what was done' },
      },
      required: ['artifacts'],
    },
  },
  {
    name: 'task_blocked',
    description: 'Declare the task as blocked due to a dependency or missing resource',
    parameters: {
      type: 'object',
      properties: {
        blocker: { type: 'string', description: 'Description of what is blocking the task' },
      },
      required: ['blocker'],
    },
  },
];

// =============================================================================
// PROMPT BUILDING
// =============================================================================

/**
 * Build the system prompt for the LLM agent.
 */
export function buildSystemPrompt(): string {
  return `You are Ralph, an agentic delivery system. You execute software engineering tasks autonomously.

## Rules
1. Read the task description and spec carefully before acting.
2. Use the provided tools to read files, write files, and run commands.
3. Work iteratively: read first, then plan, then implement.
4. When the task is complete, call task_complete with the artifacts you produced.
5. If the task is blocked by a missing dependency or resource, call task_blocked.
6. Do not modify files outside the task scope.
7. Keep changes minimal and focused on the task.
8. Write tests when the task requires code changes.

## Important
- You operate in a sandboxed environment. File changes are buffered until committed.
- Be precise with file paths. Use relative paths from the workspace root.
- If you encounter an error, analyze it and try a different approach.
- Never loop endlessly. If you cannot make progress, declare the task blocked.`;
}

/**
 * Build the user prompt for a specific task iteration.
 */
export function buildIterationPrompt(
  task: Task,
  iteration: number,
  specContent?: string,
  agentInstructions?: string,
  previousResult?: string,
): string {
  const parts: string[] = [];

  parts.push(`## Task: ${task.id} — ${task.title}`);
  parts.push(`**Status:** ${task.status}`);
  parts.push(`**Type:** ${task.type}`);
  parts.push(`**Iteration:** ${iteration}`);

  if (task.description) {
    parts.push(`\n### Description\n${task.description}`);
  }

  if (specContent) {
    parts.push(`\n### Specification\n${specContent}`);
  }

  if (agentInstructions) {
    parts.push(`\n### Agent Instructions\n${agentInstructions}`);
  }

  if (task.tags && task.tags.length > 0) {
    parts.push(`\n**Tags:** ${task.tags.join(', ')}`);
  }

  if (previousResult) {
    parts.push(`\n### Previous Iteration Result\n${previousResult}`);
  }

  parts.push(
    `\nExecute this task. Use the available tools to read files, make changes, and run commands. ` +
    `When done, call task_complete. If blocked, call task_blocked.`
  );

  return parts.join('\n');
}

// =============================================================================
// ACTION EXECUTION
// =============================================================================

/**
 * Execute a single tool call against the sandbox.
 * Returns an Action record and the tool output string for LLM feedback.
 */
export async function executeToolCall(
  executor: Executor,
  toolCall: LLMToolCall,
): Promise<{ action: Action; output: string }> {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  switch (toolCall.name) {
    case 'read_file': {
      const path = toolCall.arguments.path as string;
      try {
        const content = await executor.readFile(path);
        return {
          action: {
            type: 'read',
            target: path,
            output: `${content.length} bytes`,
            duration: Date.now() - start,
            timestamp,
          },
          output: content,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return {
          action: {
            type: 'read',
            target: path,
            output: `Error: ${msg}`,
            duration: Date.now() - start,
            timestamp,
          },
          output: `Error reading ${path}: ${msg}`,
        };
      }
    }

    case 'write_file': {
      const path = toolCall.arguments.path as string;
      const content = toolCall.arguments.content as string;
      try {
        await executor.writeFile(path, content);
        return {
          action: {
            type: 'write',
            target: path,
            input: `${content.length} bytes`,
            output: 'OK',
            duration: Date.now() - start,
            timestamp,
          },
          output: `Successfully wrote ${content.length} bytes to ${path}`,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return {
          action: {
            type: 'write',
            target: path,
            input: `${content.length} bytes`,
            output: `Error: ${msg}`,
            duration: Date.now() - start,
            timestamp,
          },
          output: `Error writing ${path}: ${msg}`,
        };
      }
    }

    case 'run_bash': {
      const command = toolCall.arguments.command as string;
      try {
        const result = await executor.bash(command);
        const output = result.exitCode === 0
          ? result.stdout || '(no output)'
          : `Exit code ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;
        return {
          action: {
            type: 'bash',
            target: command,
            output: `exit=${result.exitCode}`,
            duration: Date.now() - start,
            timestamp,
          },
          output,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return {
          action: {
            type: 'bash',
            target: command,
            output: `Error: ${msg}`,
            duration: Date.now() - start,
            timestamp,
          },
          output: `Error executing command: ${msg}`,
        };
      }
    }

    case 'task_complete': {
      const artifacts = (toolCall.arguments.artifacts as string[]) || [];
      const summary = (toolCall.arguments.summary as string) || '';
      return {
        action: {
          type: 'eval',
          target: 'task_complete',
          input: { artifacts, summary },
          duration: Date.now() - start,
          timestamp,
        },
        output: `Task declared complete. Artifacts: ${artifacts.join(', ')}`,
      };
    }

    case 'task_blocked': {
      const blocker = (toolCall.arguments.blocker as string) || 'Unknown blocker';
      return {
        action: {
          type: 'eval',
          target: 'task_blocked',
          input: { blocker },
          duration: Date.now() - start,
          timestamp,
        },
        output: `Task declared blocked: ${blocker}`,
      };
    }

    default:
      return {
        action: {
          type: 'eval',
          target: toolCall.name,
          output: `Unknown tool: ${toolCall.name}`,
          duration: Date.now() - start,
          timestamp,
        },
        output: `Unknown tool: ${toolCall.name}`,
      };
  }
}

// =============================================================================
// RESPONSE INTERPRETATION
// =============================================================================

/**
 * Determine the IterationResult from the LLM response and executed actions.
 *
 * Logic:
 * - If a task_complete tool call was made → complete
 * - If a task_blocked tool call was made → blocked
 * - If the LLM stopped without tool calls → interpret text as continue/failed
 * - If tool calls were made but no completion signal → continue
 */
export function interpretResponse(
  response: LLMResponse,
  executedToolCalls: LLMToolCall[],
): IterationResult {
  // Check for explicit completion/blocked signals
  for (const call of executedToolCalls) {
    if (call.name === 'task_complete') {
      const artifacts = (call.arguments.artifacts as string[]) || [];
      return { status: 'complete', artifacts };
    }
    if (call.name === 'task_blocked') {
      const blocker = (call.arguments.blocker as string) || 'Unknown blocker';
      return { status: 'blocked', blocker };
    }
  }

  // If LLM returned an error finish reason
  if (response.finishReason === 'error') {
    return { status: 'failed', error: response.content || 'LLM returned an error' };
  }

  // If LLM stopped (no tool calls) and has content → interpret as continue
  if (response.finishReason === 'stop' && executedToolCalls.length === 0) {
    return {
      status: 'continue',
      reason: response.content || 'LLM stopped without actions',
    };
  }

  // If length limit was hit
  if (response.finishReason === 'length') {
    return {
      status: 'continue',
      reason: 'Response truncated due to token limit',
    };
  }

  // Default: tool calls were made but no completion signal → continue
  return {
    status: 'continue',
    reason: response.content || 'Actions executed, continuing',
  };
}

// =============================================================================
// LLM ITERATION EXECUTION
// =============================================================================

/**
 * Execute a single iteration using the LLM.
 *
 * This is the core function that ties everything together:
 * 1. Build prompt from task context
 * 2. Call LLM with tools
 * 3. Execute tool calls
 * 4. Interpret result
 */
export async function executeLLMIteration(
  provider: LLMProvider,
  executor: Executor,
  task: Task,
  iteration: number,
  options: {
    specContent?: string;
    agentInstructions?: string;
    previousResult?: string;
    conversationHistory?: LLMMessage[];
  } = {},
): Promise<{ result: IterationResult; actions: Action[] }> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildIterationPrompt(
    task,
    iteration,
    options.specContent,
    options.agentInstructions,
    options.previousResult,
  );

  // Build messages: system + any conversation history + current prompt
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...(options.conversationHistory || []),
    { role: 'user', content: userPrompt },
  ];

  const actions: Action[] = [];
  const executedToolCalls: LLMToolCall[] = [];

  // Call LLM
  const response = await provider.chat(messages, AGENT_TOOLS);

  // Execute tool calls
  if (response.toolCalls.length > 0) {
    for (const toolCall of response.toolCalls) {
      executedToolCalls.push(toolCall);
      const { action } = await executeToolCall(executor, toolCall);
      actions.push(action);
    }
  }

  // Interpret result
  const result = interpretResponse(response, executedToolCalls);

  return { result, actions };
}

// =============================================================================
// PROVIDER FACTORY
// =============================================================================

/**
 * Create an LLM provider from configuration.
 *
 * Returns null if LLM is not enabled or not configured.
 * The actual API client implementation is injected to keep this module
 * testable without real HTTP calls.
 */
export function createLLMProvider(
  config: LLMConfig | undefined,
  factory?: (config: LLMConfig) => LLMProvider,
): LLMProvider | null {
  if (!config || !config.enabled) {
    return null;
  }

  if (factory) {
    return factory(config);
  }

  // Default: return null (requires explicit factory for actual API calls)
  return null;
}

/**
 * Load task context for an iteration: spec content and agent instructions.
 */
export async function loadTaskContext(
  executor: Executor,
  task: Task,
): Promise<{ specContent?: string; agentInstructions?: string }> {
  let specContent: string | undefined;
  let agentInstructions: string | undefined;

  // Load spec if referenced
  if (task.spec) {
    try {
      specContent = await executor.readFile(task.spec);
    } catch {
      // Spec doesn't exist yet — that's OK
    }
  }

  // Load agent instructions based on task type
  const agentMap: Record<string, string> = {
    task: './agents/task-discovery.md',
    feature: './agents/task-discovery.md',
    bug: './agents/task-discovery.md',
    refactor: './agents/task-discovery.md',
    docs: './agents/task-discovery.md',
    test: './agents/task-discovery.md',
    spike: './agents/task-discovery.md',
  };

  const agentPath = agentMap[task.type];
  if (agentPath) {
    try {
      agentInstructions = await executor.readFile(agentPath);
    } catch {
      // Agent instructions not available — continue without
    }
  }

  return { specContent, agentInstructions };
}
