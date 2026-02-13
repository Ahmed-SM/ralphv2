import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerTracker,
  createTracker,
  getAvailableTrackers,
  taskToIssue,
  formatDescription,
  mapStatusToRalph,
} from './tracker-interface.js';
import type { TrackerConfig, AuthConfig, Tracker } from './tracker-interface.js';
import type { Task, TaskStatus, TaskType } from '../../types/index.js';

// =============================================================================
// FIXTURES
// =============================================================================

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: 'A test task description',
    status: 'pending',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    type: 'jira',
    project: 'RALPH',
    issueTypeMap: {
      epic: 'Epic',
      feature: 'Story',
      task: 'Task',
      subtask: 'Sub-task',
      bug: 'Bug',
      refactor: 'Task',
      docs: 'Task',
      test: 'Task',
      spike: 'Spike',
    } as Record<TaskType, string>,
    statusMap: {
      discovered: 'Backlog',
      pending: 'To Do',
      in_progress: 'In Progress',
      blocked: 'Blocked',
      review: 'In Review',
      done: 'Done',
      cancelled: 'Cancelled',
    } as Record<TaskStatus, string>,
    autoCreate: true,
    autoTransition: true,
    autoComment: false,
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('taskToIssue', () => {
  it('maps task fields to issue format', () => {
    const task = makeTask({ title: 'My Feature', tags: ['auth', 'api'] });
    const config = makeConfig();
    const result = taskToIssue(task, config);

    expect(result.title).toBe('My Feature');
    expect(result.type).toBe('Task');
    expect(result.status).toBe('To Do');
    expect(result.labels).toEqual(['auth', 'api']);
  });

  it('maps task type through issueTypeMap', () => {
    const task = makeTask({ type: 'bug' });
    const config = makeConfig();
    const result = taskToIssue(task, config);

    expect(result.type).toBe('Bug');
  });

  it('maps task status through statusMap', () => {
    const task = makeTask({ status: 'in_progress' });
    const config = makeConfig();
    const result = taskToIssue(task, config);

    expect(result.status).toBe('In Progress');
  });

  it('falls back to Task for unmapped type', () => {
    const config = makeConfig({ issueTypeMap: {} as Record<TaskType, string> });
    const task = makeTask({ type: 'task' });
    const result = taskToIssue(task, config);

    expect(result.type).toBe('Task');
  });

  it('falls back to To Do for unmapped status', () => {
    const config = makeConfig({ statusMap: {} as Record<TaskStatus, string> });
    const task = makeTask({ status: 'pending' });
    const result = taskToIssue(task, config);

    expect(result.status).toBe('To Do');
  });

  it('includes description from formatDescription', () => {
    const task = makeTask({ description: 'Hello' });
    const config = makeConfig();
    const result = taskToIssue(task, config);

    expect(result.description).toContain('Hello');
    expect(result.description).toContain('Ralph Task');
  });

  it('handles task with no tags', () => {
    const task = makeTask({ tags: undefined });
    const config = makeConfig();
    const result = taskToIssue(task, config);

    expect(result.labels).toBeUndefined();
  });
});

describe('formatDescription', () => {
  it('includes task description when present', () => {
    const task = makeTask({ description: 'Do the thing' });
    const result = formatDescription(task);

    expect(result).toContain('Do the thing');
  });

  it('always includes Ralph Task section', () => {
    const task = makeTask();
    const result = formatDescription(task);

    expect(result).toContain('**Ralph Task**');
    expect(result).toContain(`- ID: ${task.id}`);
    expect(result).toContain(`- Created: ${task.createdAt}`);
  });

  it('includes spec when present', () => {
    const task = makeTask({ spec: 'specs/task-schema.md' });
    const result = formatDescription(task);

    expect(result).toContain('- Spec: specs/task-schema.md');
  });

  it('includes source path and line when present', () => {
    const task = makeTask({
      source: { type: 'spec', path: 'plan.md', line: 42, timestamp: '2025-01-01T00:00:00Z' },
    });
    const result = formatDescription(task);

    expect(result).toContain('- Source: plan.md:42');
  });

  it('omits spec line when not present', () => {
    const task = makeTask({ spec: undefined });
    const result = formatDescription(task);

    expect(result).not.toContain('- Spec:');
  });

  it('omits source line when not present', () => {
    const task = makeTask({ source: undefined });
    const result = formatDescription(task);

    expect(result).not.toContain('- Source:');
  });

  it('includes managed-by footer', () => {
    const task = makeTask();
    const result = formatDescription(task);

    expect(result).toContain('_Managed by Ralph. Do not edit this section._');
  });

  it('handles empty description', () => {
    const task = makeTask({ description: '' });
    const result = formatDescription(task);

    expect(result).toContain('**Ralph Task**');
    expect(result).not.toMatch(/^\n/);
  });
});

describe('mapStatusToRalph', () => {
  const config = makeConfig();

  it('uses reverseStatusMap when available', () => {
    const cfg = makeConfig({
      reverseStatusMap: { 'In Progress': 'in_progress', 'Done': 'done' },
    });
    expect(mapStatusToRalph('In Progress', cfg)).toBe('in_progress');
    expect(mapStatusToRalph('Done', cfg)).toBe('done');
  });

  it('falls back to forward map with case-insensitive match', () => {
    expect(mapStatusToRalph('to do', config)).toBe('pending');
    expect(mapStatusToRalph('In Progress', config)).toBe('in_progress');
    expect(mapStatusToRalph('DONE', config)).toBe('done');
  });

  it('maps common done-like statuses', () => {
    expect(mapStatusToRalph('Closed', config)).toBe('done');
    expect(mapStatusToRalph('Resolved', config)).toBe('done');
    expect(mapStatusToRalph('All Done', config)).toBe('done');
  });

  it('maps common progress-like statuses', () => {
    expect(mapStatusToRalph('Active', config)).toBe('in_progress');
    expect(mapStatusToRalph('In Active Development', config)).toBe('in_progress');
  });

  it('maps review statuses', () => {
    expect(mapStatusToRalph('Under Review', config)).toBe('review');
    expect(mapStatusToRalph('Code Review', config)).toBe('review');
  });

  it('maps blocked statuses', () => {
    expect(mapStatusToRalph('Blocked by dependency', config)).toBe('blocked');
  });

  it('defaults to pending for unknown statuses', () => {
    expect(mapStatusToRalph('SomeRandomStatus', config)).toBe('pending');
  });

  it('prefers reverseStatusMap over forward map', () => {
    const cfg = makeConfig({
      reverseStatusMap: { 'Done': 'cancelled' }, // override
    });
    expect(mapStatusToRalph('Done', cfg)).toBe('cancelled');
  });
});

describe('registerTracker / createTracker / getAvailableTrackers', () => {
  beforeEach(() => {
    // Register a test tracker
    registerTracker('test-tracker', async (_config, _auth) => {
      return {
        name: 'test-tracker',
        connect: async () => {},
        disconnect: async () => {},
        healthCheck: async () => ({ healthy: true }),
        createIssue: async (task: Task) => ({
          id: '1',
          key: 'TEST-1',
          url: 'http://test/1',
          title: task.title,
          description: '',
          status: 'Open',
          type: 'Task',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        }),
        updateIssue: async () => {},
        getIssue: async () => ({} as any),
        findIssues: async () => [],
        createSubtask: async () => ({} as any),
        linkIssues: async () => {},
        transitionIssue: async () => {},
        getTransitions: async () => [],
        addComment: async () => {},
      } as Tracker;
    });
  });

  it('registers and creates a tracker', async () => {
    const config = makeConfig({ type: 'test-tracker' as any });
    const auth: AuthConfig = { type: 'token', token: 'abc' };
    const tracker = await createTracker(config, auth);

    expect(tracker.name).toBe('test-tracker');
  });

  it('lists registered trackers', () => {
    const available = getAvailableTrackers();
    expect(available).toContain('test-tracker');
  });

  it('throws for unknown tracker type', async () => {
    const config = makeConfig({ type: 'nonexistent' as any });
    const auth: AuthConfig = { type: 'token', token: 'abc' };

    await expect(createTracker(config, auth)).rejects.toThrow('Unknown tracker type: nonexistent');
  });
});
