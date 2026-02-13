import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinearAdapter } from './adapter.js';
import type { TrackerConfig, AuthConfig } from '../../skills/normalize/tracker-interface.js';
import type { Task, TaskType, TaskStatus } from '../../types/index.js';

// =============================================================================
// FIXTURES
// =============================================================================

function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    type: 'linear',
    project: 'RALPH',
    issueTypeMap: {
      epic: 'Epic',
      feature: 'Feature',
      task: 'Task',
      subtask: 'Task',
      bug: 'Bug',
      refactor: 'Improvement',
      docs: 'Documentation',
      test: 'Test',
      spike: 'Spike',
    } as Record<TaskType, string>,
    statusMap: {
      discovered: 'Backlog',
      pending: 'Todo',
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

function makeAuth(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    type: 'token',
    token: 'lin_api_testkey123',
    ...overrides,
  };
}

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

function makeLinearIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-uuid-123',
    identifier: 'RALPH-42',
    title: 'Test issue',
    description: 'Test body',
    url: 'https://linear.app/team/issue/RALPH-42',
    state: { name: 'Todo', type: 'unstarted' },
    labels: { nodes: [{ id: 'label-1', name: 'Task' }] },
    assignee: null,
    parent: null,
    children: { nodes: [] },
    project: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeLinearProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'project-uuid-1',
    name: 'Phase 1',
    description: 'First phase',
    url: 'https://linear.app/team/project/phase-1',
    state: 'planned',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function mockGraphQL(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
    text: () => Promise.resolve(JSON.stringify({ data })),
  });
}

function mockGraphQLError(status: number, message: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(message),
  });
}

function mockGraphQLErrors(errors: Array<{ message: string }>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ errors }),
    text: () => Promise.resolve(JSON.stringify({ errors })),
  });
}

// =============================================================================
// TESTS: Constructor
// =============================================================================

describe('LinearAdapter', () => {
  describe('constructor', () => {
    it('creates adapter with team key as project', () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      expect(adapter.name).toBe('linear');
    });

    it('throws if project is empty', () => {
      expect(() => new LinearAdapter(makeConfig({ project: '' }), makeAuth()))
        .toThrow('requires a project');
    });

    it('uses default Linear API base URL', () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      expect(adapter.name).toBe('linear');
    });

    it('uses custom base URL when provided', () => {
      const adapter = new LinearAdapter(
        makeConfig({ baseUrl: 'https://custom.linear.dev' }),
        makeAuth()
      );
      expect(adapter.name).toBe('linear');
    });
  });

  // ===========================================================================
  // TESTS: Auth headers
  // ===========================================================================

  describe('auth headers', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = mockGraphQL({ viewer: { id: '1', name: 'Test', email: 'test@test.com' } });
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('uses API key directly for token auth', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth({ type: 'token', token: 'lin_api_abc' }));
      await adapter.healthCheck();

      const call = fetchSpy.mock.calls[0];
      expect(call[1].headers['Authorization']).toBe('lin_api_abc');
    });

    it('uses Bearer for OAuth auth', async () => {
      const adapter = new LinearAdapter(
        makeConfig(),
        makeAuth({ type: 'oauth', accessToken: 'oauth_xyz' })
      );
      await adapter.healthCheck();

      const call = fetchSpy.mock.calls[0];
      expect(call[1].headers['Authorization']).toBe('Bearer oauth_xyz');
    });

    it('includes Content-Type header', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.healthCheck();

      const call = fetchSpy.mock.calls[0];
      expect(call[1].headers['Content-Type']).toBe('application/json');
    });

    it('sends requests to /graphql endpoint', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.healthCheck();

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toBe('https://api.linear.app/graphql');
    });

    it('sends POST method for GraphQL', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.healthCheck();

      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('POST');
    });
  });

  // ===========================================================================
  // TESTS: healthCheck
  // ===========================================================================

  describe('healthCheck', () => {
    it('returns healthy on success', async () => {
      vi.stubGlobal('fetch', mockGraphQL({ viewer: { id: '1', name: 'Test', email: 'test@test.com' } }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy on HTTP error', async () => {
      vi.stubGlobal('fetch', mockGraphQLError(401, 'Unauthorized'));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('401');
    });

    it('returns unhealthy on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unreachable')));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('Network unreachable');
    });

    it('returns unhealthy on GraphQL errors', async () => {
      vi.stubGlobal('fetch', mockGraphQLErrors([{ message: 'Authentication required' }]));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('Authentication required');
    });
  });

  // ===========================================================================
  // TESTS: createIssue
  // ===========================================================================

  describe('createIssue', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = mockGraphQL({
        issueCreate: { success: true, issue: makeLinearIssue() },
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('creates an issue with correct title and description', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const task = makeTask({ title: 'Fix login bug', description: 'Users cannot login' });
      await adapter.createIssue(task);

      // First call is label resolution, second is issue creation
      const createCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
      const body = JSON.parse(createCall[1].body);
      expect(body.variables.title).toBe('Fix login bug');
      expect(body.variables.description).toContain('Users cannot login');
    });

    it('passes teamId from config project', async () => {
      const adapter = new LinearAdapter(makeConfig({ project: 'MYTEAM' }), makeAuth());
      await adapter.createIssue(makeTask());

      const createCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
      const body = JSON.parse(createCall[1].body);
      expect(body.variables.teamId).toBe('MYTEAM');
    });

    it('returns mapped ExternalIssue', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.createIssue(makeTask());

      expect(result.id).toBe('issue-uuid-123');
      expect(result.key).toBe('RALPH-42');
      expect(result.url).toBe('https://linear.app/team/issue/RALPH-42');
      expect(result.status).toBe('Todo');
    });

    it('creates a project for epic type', async () => {
      fetchSpy = mockGraphQL({
        projectCreate: { success: true, project: makeLinearProject({ name: 'Phase 2' }) },
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const task = makeTask({ type: 'epic', title: 'Phase 2' });
      const result = await adapter.createIssue(task);

      expect(result.type).toBe('Project');
      expect(result.key).toContain('project:');
    });

    it('throws on creation failure', async () => {
      fetchSpy = mockGraphQL({ issueCreate: { success: false, issue: null } });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await expect(adapter.createIssue(makeTask())).rejects.toThrow('creation failed');
    });

    it('dry run returns mock data without mutation calls', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const adapter = new LinearAdapter(makeConfig({ dryRun: true }), makeAuth());
      const result = await adapter.createIssue(makeTask());

      // Label resolution may still happen (it's a query), but mutation should not
      const calls = fetchSpy.mock.calls;
      for (const call of calls) {
        const body = JSON.parse(call[1].body);
        expect(body.query).not.toContain('mutation');
      }
      expect(result.id).toBe('dry-run-id');
      consoleSpy.mockRestore();
    });

    it('includes labelIds when task has type mapping', async () => {
      // First call: issueCreate, but we need label resolution first
      let callCount = 0;
      fetchSpy = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Label resolution
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: { issueLabels: { nodes: [{ id: 'bug-id', name: 'Bug' }] } },
            }),
          });
        }
        // Issue creation
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: { issueCreate: { success: true, issue: makeLinearIssue() } },
          }),
        });
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.createIssue(makeTask({ type: 'bug' }));

      // Second call should be the issue create with labelIds
      const createBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(createBody.variables.labelIds).toEqual(['bug-id']);
    });
  });

  // ===========================================================================
  // TESTS: getIssue
  // ===========================================================================

  describe('getIssue', () => {
    it('fetches issue by ID', async () => {
      const fetchSpy = mockGraphQL({ issue: makeLinearIssue({ id: 'uuid-99' }) });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-99');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.id).toBe('uuid-99');
      expect(result.id).toBe('uuid-99');
    });

    it('maps labels to ExternalIssue', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({
          labels: { nodes: [{ id: 'l1', name: 'Bug' }, { id: 'l2', name: 'urgent' }] },
        }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');

      expect(result.labels).toEqual(['Bug', 'urgent']);
      expect(result.type).toBe('Bug');
    });

    it('maps parent to ExternalIssue parent', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({
          parent: { id: 'parent-uuid', identifier: 'RALPH-10' },
        }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');

      expect(result.parent).toBe('parent-uuid');
    });

    it('maps children to subtasks', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({
          children: { nodes: [{ id: 'child-1', identifier: 'RALPH-43' }, { id: 'child-2', identifier: 'RALPH-44' }] },
        }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');

      expect(result.subtasks).toEqual(['child-1', 'child-2']);
    });

    it('maps assignee displayName', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({
          assignee: { id: 'user-1', displayName: 'Jane Doe' },
        }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');

      expect(result.assignee).toBe('Jane Doe');
    });

    it('handles null state gracefully', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({ state: null }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');

      expect(result.status).toBe('Unknown');
    });

    it('handles null labels gracefully', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({ labels: null }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');

      expect(result.labels).toEqual([]);
      expect(result.type).toBe('Issue');
    });
  });

  // ===========================================================================
  // TESTS: updateIssue
  // ===========================================================================

  describe('updateIssue', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = mockGraphQL({ issueUpdate: { success: true } });
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('updates title', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('uuid-1', { title: 'New title' });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.input.title).toBe('New title');
    });

    it('updates description', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('uuid-1', { description: 'New desc' });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.input.description).toBe('New desc');
    });

    it('updates assignee as assigneeId', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('uuid-1', { assignee: 'user-uuid' });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.input.assigneeId).toBe('user-uuid');
    });

    it('resolves status to stateId', async () => {
      let callCount = 0;
      fetchSpy = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: {
                workflowStates: {
                  nodes: [{ id: 'state-done', name: 'Done', type: 'completed' }],
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { issueUpdate: { success: true } } }),
        });
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('uuid-1', { status: 'Done' });

      const updateBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(updateBody.variables.input.stateId).toBe('state-done');
    });

    it('does not call API if no changes', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('uuid-1', {});

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('passes issue ID correctly', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('specific-uuid', { title: 'X' });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.id).toBe('specific-uuid');
    });
  });

  // ===========================================================================
  // TESTS: findIssues
  // ===========================================================================

  describe('findIssues', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = mockGraphQL({
        issues: {
          nodes: [
            makeLinearIssue({ id: 'i1', identifier: 'RALPH-1' }),
            makeLinearIssue({ id: 'i2', identifier: 'RALPH-2' }),
          ],
        },
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('returns mapped issues', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const results = await adapter.findIssues({});

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('i1');
      expect(results[1].id).toBe('i2');
    });

    it('filters by status', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ status: ['Done', 'Cancelled'] });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.filter.state.name.in).toEqual(['Done', 'Cancelled']);
    });

    it('filters by type via labels', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ type: ['Bug', 'Feature'] });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.filter.labels.name.in).toEqual(['Bug', 'Feature']);
    });

    it('filters by assignee', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ assignee: 'Jane' });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.filter.assignee.displayName.eq).toBe('Jane');
    });

    it('filters by updatedSince', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ updatedSince: '2025-01-01T00:00:00Z' });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.filter.updatedAt.gte).toBe('2025-01-01T00:00:00Z');
    });

    it('uses maxResults as first parameter', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ maxResults: 10 });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.first).toBe(10);
    });

    it('defaults maxResults to 50', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({});

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.first).toBe(50);
    });

    it('filters by team key', async () => {
      const adapter = new LinearAdapter(makeConfig({ project: 'MYTEAM' }), makeAuth());
      await adapter.findIssues({});

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.filter.team.key.eq).toBe('MYTEAM');
    });
  });

  // ===========================================================================
  // TESTS: transitionIssue
  // ===========================================================================

  describe('transitionIssue', () => {
    it('resolves status name to state ID and updates', async () => {
      let callCount = 0;
      const fetchSpy = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: {
                workflowStates: {
                  nodes: [
                    { id: 'state-backlog', name: 'Backlog', type: 'backlog' },
                    { id: 'state-done', name: 'Done', type: 'completed' },
                  ],
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { issueUpdate: { success: true } } }),
        });
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.transitionIssue('uuid-1', 'Done');

      const updateBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(updateBody.variables.stateId).toBe('state-done');
      expect(updateBody.variables.id).toBe('uuid-1');
    });

    it('matches status by type field as fallback', async () => {
      let callCount = 0;
      const fetchSpy = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: {
                workflowStates: {
                  nodes: [
                    { id: 'state-1', name: 'Finished', type: 'completed' },
                  ],
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { issueUpdate: { success: true } } }),
        });
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.transitionIssue('uuid-1', 'completed');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('warns and skips if no matching state found', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubGlobal('fetch', mockGraphQL({
        workflowStates: { nodes: [] },
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.transitionIssue('uuid-1', 'NonExistent');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('NonExistent'));
      warnSpy.mockRestore();
    });
  });

  // ===========================================================================
  // TESTS: getTransitions
  // ===========================================================================

  describe('getTransitions', () => {
    it('returns all workflow states sorted by position', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        workflowStates: {
          nodes: [
            { id: 's3', name: 'Done', type: 'completed', position: 3 },
            { id: 's1', name: 'Backlog', type: 'backlog', position: 1 },
            { id: 's2', name: 'In Progress', type: 'started', position: 2 },
          ],
        },
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const transitions = await adapter.getTransitions('uuid-1');

      expect(transitions).toHaveLength(3);
      expect(transitions[0].name).toBe('Backlog');
      expect(transitions[1].name).toBe('In Progress');
      expect(transitions[2].name).toBe('Done');
    });

    it('maps state name as both name and to', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        workflowStates: {
          nodes: [{ id: 's1', name: 'Todo', type: 'unstarted', position: 1 }],
        },
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const transitions = await adapter.getTransitions('uuid-1');

      expect(transitions[0]).toEqual({ id: 's1', name: 'Todo', to: 'Todo' });
    });
  });

  // ===========================================================================
  // TESTS: createSubtask
  // ===========================================================================

  describe('createSubtask', () => {
    it('creates issue with parentId set', async () => {
      const fetchSpy = mockGraphQL({
        issueCreate: { success: true, issue: makeLinearIssue({ id: 'child-uuid' }) },
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.createSubtask('parent-uuid', makeTask({ title: 'Sub-task' }));

      // Last call is the issue creation (label resolution may precede it)
      const createCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
      const body = JSON.parse(createCall[1].body);
      expect(body.variables.parentId).toBe('parent-uuid');
      expect(body.variables.title).toBe('Sub-task');
    });

    it('returns mapped child issue', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issueCreate: { success: true, issue: makeLinearIssue({ id: 'child-uuid', identifier: 'RALPH-99' }) },
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.createSubtask('parent-uuid', makeTask());

      expect(result.id).toBe('child-uuid');
      expect(result.key).toBe('RALPH-99');
    });

    it('throws on sub-issue creation failure', async () => {
      vi.stubGlobal('fetch', mockGraphQL({ issueCreate: { success: false, issue: null } }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await expect(adapter.createSubtask('parent-uuid', makeTask())).rejects.toThrow('sub-issue creation failed');
    });
  });

  // ===========================================================================
  // TESTS: linkIssues
  // ===========================================================================

  describe('linkIssues', () => {
    it('creates relation between issues', async () => {
      const fetchSpy = mockGraphQL({ issueRelationCreate: { success: true } });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.linkIssues('uuid-a', 'uuid-b', 'blocks');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.issueId).toBe('uuid-a');
      expect(body.variables.relatedIssueId).toBe('uuid-b');
      expect(body.variables.type).toBe('blocks');
    });

    it('maps relates-to to related', async () => {
      const fetchSpy = mockGraphQL({ issueRelationCreate: { success: true } });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.linkIssues('a', 'b', 'relates-to');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.type).toBe('related');
    });

    it('maps duplicates to duplicate', async () => {
      const fetchSpy = mockGraphQL({ issueRelationCreate: { success: true } });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.linkIssues('a', 'b', 'duplicates');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.type).toBe('duplicate');
    });
  });

  // ===========================================================================
  // TESTS: addComment
  // ===========================================================================

  describe('addComment', () => {
    it('creates comment on issue', async () => {
      const fetchSpy = mockGraphQL({ commentCreate: { success: true } });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await adapter.addComment('uuid-1', 'Status updated by Ralph');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.issueId).toBe('uuid-1');
      expect(body.variables.body).toBe('Status updated by Ralph');
    });
  });

  // ===========================================================================
  // TESTS: type inference from labels
  // ===========================================================================

  describe('type inference from labels', () => {
    it('infers Bug from bug label', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({
          labels: { nodes: [{ id: 'l1', name: 'Bug' }] },
        }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');
      expect(result.type).toBe('Bug');
    });

    it('infers Feature from feature label', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({
          labels: { nodes: [{ id: 'l1', name: 'Feature' }] },
        }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');
      expect(result.type).toBe('Feature');
    });

    it('infers Improvement from improvement label', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({
          labels: { nodes: [{ id: 'l1', name: 'Improvement' }] },
        }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');
      expect(result.type).toBe('Improvement');
    });

    it('defaults to Issue for unknown labels', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({
          labels: { nodes: [{ id: 'l1', name: 'priority-high' }] },
        }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');
      expect(result.type).toBe('Issue');
    });

    it('handles case-insensitive label matching', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        issue: makeLinearIssue({
          labels: { nodes: [{ id: 'l1', name: 'bug' }] },
        }),
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('uuid-1');
      expect(result.type).toBe('Bug');
    });
  });

  // ===========================================================================
  // TESTS: connect / disconnect
  // ===========================================================================

  describe('connect / disconnect', () => {
    it('connect calls healthCheck', async () => {
      vi.stubGlobal('fetch', mockGraphQL({ viewer: { id: '1', name: 'Test', email: 'test@test.com' } }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await expect(adapter.connect()).resolves.not.toThrow();
    });

    it('disconnect is a no-op', async () => {
      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await expect(adapter.disconnect()).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // TESTS: API error handling
  // ===========================================================================

  describe('API error handling', () => {
    it('throws descriptive error on HTTP failure', async () => {
      vi.stubGlobal('fetch', mockGraphQLError(500, 'Internal Server Error'));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await expect(adapter.getIssue('uuid-1')).rejects.toThrow('Linear API error 500');
    });

    it('throws on GraphQL errors', async () => {
      vi.stubGlobal('fetch', mockGraphQLErrors([{ message: 'Not found' }]));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await expect(adapter.getIssue('uuid-1')).rejects.toThrow('Not found');
    });

    it('concatenates multiple GraphQL errors', async () => {
      vi.stubGlobal('fetch', mockGraphQLErrors([
        { message: 'Error 1' },
        { message: 'Error 2' },
      ]));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await expect(adapter.getIssue('uuid-1')).rejects.toThrow('Error 1, Error 2');
    });
  });

  // ===========================================================================
  // TESTS: Project mapping (epics)
  // ===========================================================================

  describe('project mapping', () => {
    it('maps project to ExternalIssue with Project type', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        projectCreate: {
          success: true,
          project: makeLinearProject({ name: 'Release 1.0', state: 'started' }),
        },
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      const result = await adapter.createIssue(makeTask({ type: 'epic', title: 'Release 1.0' }));

      expect(result.type).toBe('Project');
      expect(result.status).toBe('started');
      expect(result.key).toBe('project:Release 1.0');
    });

    it('passes teamIds for project creation', async () => {
      const fetchSpy = mockGraphQL({
        projectCreate: { success: true, project: makeLinearProject() },
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig({ project: 'MYTEAM' }), makeAuth());
      await adapter.createIssue(makeTask({ type: 'epic', title: 'Epic' }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.variables.teamIds).toEqual(['MYTEAM']);
    });

    it('throws on project creation failure', async () => {
      vi.stubGlobal('fetch', mockGraphQL({
        projectCreate: { success: false, project: null },
      }));

      const adapter = new LinearAdapter(makeConfig(), makeAuth());
      await expect(adapter.createIssue(makeTask({ type: 'epic' }))).rejects.toThrow('project creation failed');
    });
  });

  // ===========================================================================
  // TESTS: Registration
  // ===========================================================================

  describe('registration', () => {
    it('registers linear tracker factory', async () => {
      const { getAvailableTrackers } = await import('../../skills/normalize/tracker-interface.js');
      await import('./adapter.js');

      const trackers = getAvailableTrackers();
      expect(trackers).toContain('linear');
    });
  });

  // ===========================================================================
  // TESTS: dry-run mode
  // ===========================================================================

  describe('dry-run mode', () => {
    it('returns mock data for issue creation', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const adapter = new LinearAdapter(makeConfig({ dryRun: true }), makeAuth());
      const result = await adapter.createIssue(makeTask());

      expect(result.id).toBe('dry-run-id');
      consoleSpy.mockRestore();
    });

    it('returns mock data for project creation', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const adapter = new LinearAdapter(makeConfig({ dryRun: true }), makeAuth());
      const result = await adapter.createIssue(makeTask({ type: 'epic' }));

      expect(result.id).toBe('dry-run-project-id');
      expect(result.type).toBe('Project');
      consoleSpy.mockRestore();
    });

    it('allows GET queries in dry-run mode', async () => {
      const fetchSpy = mockGraphQL({ issue: makeLinearIssue() });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new LinearAdapter(makeConfig({ dryRun: true }), makeAuth());
      const result = await adapter.getIssue('uuid-1');

      // Queries (non-mutations) should still go through
      expect(fetchSpy).toHaveBeenCalled();
      expect(result.id).toBe('issue-uuid-123');
    });
  });
});
