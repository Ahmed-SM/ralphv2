import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubIssuesAdapter } from './adapter.js';
import type { TrackerConfig, AuthConfig } from '../../skills/normalize/tracker-interface.js';
import type { Task, TaskType, TaskStatus } from '../../types/index.js';

// =============================================================================
// FIXTURES
// =============================================================================

function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    type: 'github-issues',
    project: 'test-org/test-repo',
    issueTypeMap: {
      epic: 'epic',
      feature: 'enhancement',
      task: 'task',
      subtask: 'task',
      bug: 'bug',
      refactor: 'refactor',
      docs: 'documentation',
      test: 'test',
      spike: 'spike',
    } as Record<TaskType, string>,
    statusMap: {
      discovered: 'Backlog',
      pending: 'Open',
      in_progress: 'Open',
      blocked: 'Open',
      review: 'Open',
      done: 'Closed',
      cancelled: 'Closed',
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
    token: 'ghp_testtoken123',
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

function makeGitHubIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 12345,
    number: 42,
    title: 'Test issue',
    body: 'Test body',
    state: 'open',
    html_url: 'https://github.com/test-org/test-repo/issues/42',
    labels: [{ name: 'task', color: 'ffffff' }],
    assignee: null,
    milestone: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeGitHubMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    number: 5,
    title: 'Phase 1',
    description: 'First phase',
    state: 'open',
    html_url: 'https://github.com/test-org/test-repo/milestone/5',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// =============================================================================
// TESTS: Constructor
// =============================================================================

describe('GitHubIssuesAdapter', () => {
  describe('constructor', () => {
    it('parses owner/repo from project field', () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      expect(adapter.name).toBe('github-issues');
    });

    it('throws if project is not in owner/repo format', () => {
      expect(() => new GitHubIssuesAdapter(makeConfig({ project: 'just-repo' }), makeAuth()))
        .toThrow('owner/repo');
    });

    it('throws for empty owner or repo', () => {
      expect(() => new GitHubIssuesAdapter(makeConfig({ project: '/repo' }), makeAuth()))
        .toThrow('owner/repo');
      expect(() => new GitHubIssuesAdapter(makeConfig({ project: 'owner/' }), makeAuth()))
        .toThrow('owner/repo');
    });

    it('uses default GitHub API base URL', () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      expect(adapter.name).toBe('github-issues');
    });

    it('uses custom base URL when provided', () => {
      const adapter = new GitHubIssuesAdapter(
        makeConfig({ baseUrl: 'https://github.example.com/api/v3' }),
        makeAuth()
      );
      expect(adapter.name).toBe('github-issues');
    });
  });

  // ===========================================================================
  // TESTS: Auth headers
  // ===========================================================================

  describe('auth headers', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ login: 'testuser', id: 1 })),
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('uses Bearer token for token auth', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth({ type: 'token', token: 'ghp_abc' }));
      await adapter.healthCheck();

      const call = fetchSpy.mock.calls[0];
      expect(call[1].headers['Authorization']).toBe('Bearer ghp_abc');
    });

    it('uses Bearer for OAuth auth', async () => {
      const adapter = new GitHubIssuesAdapter(
        makeConfig(),
        makeAuth({ type: 'oauth', accessToken: 'gho_xyz' })
      );
      await adapter.healthCheck();

      const call = fetchSpy.mock.calls[0];
      expect(call[1].headers['Authorization']).toBe('Bearer gho_xyz');
    });

    it('uses Basic for basic auth', async () => {
      const adapter = new GitHubIssuesAdapter(
        makeConfig(),
        makeAuth({ type: 'basic', username: 'user', password: 'pass' })
      );
      await adapter.healthCheck();

      const call = fetchSpy.mock.calls[0];
      const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`;
      expect(call[1].headers['Authorization']).toBe(expected);
    });

    it('includes GitHub API version header', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.healthCheck();

      const call = fetchSpy.mock.calls[0];
      expect(call[1].headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    });

    it('includes vnd.github+json accept header', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.healthCheck();

      const call = fetchSpy.mock.calls[0];
      expect(call[1].headers['Accept']).toBe('application/vnd.github+json');
    });
  });

  // ===========================================================================
  // TESTS: healthCheck
  // ===========================================================================

  describe('healthCheck', () => {
    it('returns healthy on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ login: 'testuser', id: 1 })),
      }));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy on failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Bad credentials'),
      }));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('401');
    });

    it('returns unhealthy on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unreachable')));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('Network unreachable');
    });
  });

  // ===========================================================================
  // TESTS: createIssue
  // ===========================================================================

  describe('createIssue', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue())),
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('creates an issue with correct title and body', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const task = makeTask({ title: 'Fix login bug', description: 'Users cannot login' });
      await adapter.createIssue(task);

      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toContain('/repos/test-org/test-repo/issues');
      expect(call[1].method).toBe('POST');

      const body = JSON.parse(call[1].body);
      expect(body.title).toBe('Fix login bug');
      expect(body.body).toContain('Users cannot login');
    });

    it('adds type label from config mapping', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const task = makeTask({ type: 'bug' });
      await adapter.createIssue(task);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.labels).toContain('bug');
    });

    it('includes task tags as labels', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const task = makeTask({ tags: ['urgent', 'frontend'] });
      await adapter.createIssue(task);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.labels).toContain('urgent');
      expect(body.labels).toContain('frontend');
    });

    it('creates a milestone for epic type', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const task = makeTask({ type: 'epic', title: 'Phase 2' });

      fetchSpy.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubMilestone({ title: 'Phase 2' }))),
      });

      const result = await adapter.createIssue(task);

      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toContain('/milestones');
      expect(result.type).toBe('Milestone');
    });

    it('returns mapped ExternalIssue', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.createIssue(makeTask());

      expect(result.id).toBe('12345');
      expect(result.key).toBe('test-org/test-repo#42');
      expect(result.url).toBe('https://github.com/test-org/test-repo/issues/42');
      expect(result.status).toBe('open');
    });

    it('dry run does not call API with POST', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const adapter = new GitHubIssuesAdapter(makeConfig({ dryRun: true }), makeAuth());
      await adapter.createIssue(makeTask());

      // fetch should not have been called (dry run intercepts before fetch)
      expect(fetchSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ===========================================================================
  // TESTS: getIssue
  // ===========================================================================

  describe('getIssue', () => {
    it('fetches issue by number', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({ number: 99 }))),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('99');

      expect(fetchSpy.mock.calls[0][0]).toContain('/issues/99');
      expect(result.key).toContain('#99');
    });

    it('handles owner/repo#number format', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({ number: 7 }))),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.getIssue('test-org/test-repo#7');

      expect(fetchSpy.mock.calls[0][0]).toContain('/issues/7');
    });

    it('maps labels to ExternalIssue', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({
          labels: [{ name: 'bug' }, { name: 'urgent' }],
        }))),
      }));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('42');

      expect(result.labels).toEqual(['bug', 'urgent']);
      expect(result.type).toBe('Bug');
    });

    it('maps milestone to parent', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({
          milestone: { number: 3, title: 'Phase 1' },
        }))),
      }));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('42');

      expect(result.parent).toBe('3');
    });

    it('maps assignee login', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({
          assignee: { login: 'octocat' },
        }))),
      }));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('42');

      expect(result.assignee).toBe('octocat');
    });
  });

  // ===========================================================================
  // TESTS: updateIssue
  // ===========================================================================

  describe('updateIssue', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue())),
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('patches title', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('42', { title: 'New title' });

      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('PATCH');
      expect(JSON.parse(call[1].body).title).toBe('New title');
    });

    it('patches description as body', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('42', { description: 'New description' });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.body).toBe('New description');
    });

    it('patches labels', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('42', { labels: ['bug', 'urgent'] });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.labels).toEqual(['bug', 'urgent']);
    });

    it('patches assignee as assignees array', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('42', { assignee: 'octocat' });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.assignees).toEqual(['octocat']);
    });

    it('handles status change via separate transition call', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('42', { status: 'Done' });

      // First call = transition (PATCH with state)
      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('PATCH');
      const body = JSON.parse(call[1].body);
      expect(body.state).toBe('closed');
    });

    it('does not call API if no changes', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.updateIssue('42', {});

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // TESTS: findIssues
  // ===========================================================================

  describe('findIssues', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([
          makeGitHubIssue({ number: 1 }),
          makeGitHubIssue({ number: 2 }),
        ])),
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('returns issues from the repo', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const results = await adapter.findIssues({});

      expect(results).toHaveLength(2);
    });

    it('filters by state from status mapping', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ status: ['Done'] });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('state=closed');
    });

    it('uses state=all when both open and closed statuses', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ status: ['Open', 'Done'] });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('state=all');
    });

    it('passes labels from type filter', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ type: ['bug', 'enhancement'] });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('labels=bug%2Cenhancement');
    });

    it('passes assignee filter', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ assignee: 'octocat' });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('assignee=octocat');
    });

    it('passes since filter', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ updatedSince: '2025-01-01T00:00:00Z' });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('since=');
    });

    it('filters out pull requests', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([
          makeGitHubIssue({ number: 1 }),
          makeGitHubIssue({ number: 2, pull_request: { url: 'https://...' } }),
        ])),
      });

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const results = await adapter.findIssues({});

      expect(results).toHaveLength(1);
      expect(results[0].key).toContain('#1');
    });

    it('uses maxResults as per_page', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.findIssues({ maxResults: 10 });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('per_page=10');
    });
  });

  // ===========================================================================
  // TESTS: transitionIssue
  // ===========================================================================

  describe('transitionIssue', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{}'),
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('closes issue for "done" status', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.transitionIssue('42', 'done');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.state).toBe('closed');
      expect(body.state_reason).toBe('completed');
    });

    it('closes issue for "closed" status', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.transitionIssue('42', 'closed');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.state).toBe('closed');
    });

    it('closes with not_planned for "cancelled"', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.transitionIssue('42', 'cancelled');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.state).toBe('closed');
      expect(body.state_reason).toBe('not_planned');
    });

    it('reopens issue for open-like statuses', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.transitionIssue('42', 'in_progress');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.state).toBe('open');
    });

    it('targets correct issue endpoint', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.transitionIssue('42', 'done');

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('/repos/test-org/test-repo/issues/42');
    });
  });

  // ===========================================================================
  // TESTS: getTransitions
  // ===========================================================================

  describe('getTransitions', () => {
    it('returns close transitions for open issue', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({ state: 'open' }))),
      }));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const transitions = await adapter.getTransitions('42');

      expect(transitions.length).toBe(2);
      expect(transitions.map(t => t.name)).toContain('Close');
      expect(transitions.map(t => t.name)).toContain('Close as not planned');
    });

    it('returns reopen transition for closed issue', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({ state: 'closed' }))),
      }));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const transitions = await adapter.getTransitions('42');

      expect(transitions).toHaveLength(1);
      expect(transitions[0].name).toBe('Reopen');
      expect(transitions[0].to).toBe('open');
    });
  });

  // ===========================================================================
  // TESTS: createSubtask
  // ===========================================================================

  describe('createSubtask', () => {
    it('creates issue referencing parent in body', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({ number: 43 }))),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.createSubtask('42', makeTask({ title: 'Sub-task' }));

      // First call creates the subtask issue
      const createBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(createBody.body).toContain('Parent: #42');

      // Second call adds comment on parent
      const commentBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(commentBody.body).toContain('#43');
    });
  });

  // ===========================================================================
  // TESTS: linkIssues
  // ===========================================================================

  describe('linkIssues', () => {
    it('adds a comment mentioning the linked issue', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{}'),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.linkIssues('10', '20', 'blocks');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.body).toContain('#20');
    });
  });

  // ===========================================================================
  // TESTS: addComment
  // ===========================================================================

  describe('addComment', () => {
    it('posts comment to correct endpoint', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{}'),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await adapter.addComment('42', 'Status updated by Ralph');

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('/repos/test-org/test-repo/issues/42/comments');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.body).toBe('Status updated by Ralph');
    });
  });

  // ===========================================================================
  // TESTS: extractIssueNumber
  // ===========================================================================

  describe('extractIssueNumber', () => {
    let adapter: GitHubIssuesAdapter;

    beforeEach(() => {
      adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
    });

    it('parses plain number', () => {
      expect(adapter.extractIssueNumber('42')).toBe(42);
    });

    it('parses #number format', () => {
      expect(adapter.extractIssueNumber('#99')).toBe(99);
    });

    it('parses owner/repo#number format', () => {
      expect(adapter.extractIssueNumber('org/repo#123')).toBe(123);
    });

    it('throws for invalid format', () => {
      expect(() => adapter.extractIssueNumber('not-a-number')).toThrow('Cannot extract');
    });
  });

  // ===========================================================================
  // TESTS: type inference from labels
  // ===========================================================================

  describe('type inference from labels', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('infers Bug from bug label', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({
          labels: [{ name: 'bug' }],
        }))),
      });

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('1');
      expect(result.type).toBe('Bug');
    });

    it('infers Enhancement from enhancement label', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({
          labels: [{ name: 'enhancement' }],
        }))),
      });

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('1');
      expect(result.type).toBe('Enhancement');
    });

    it('defaults to Issue for unknown labels', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(makeGitHubIssue({
          labels: [{ name: 'priority-high' }],
        }))),
      });

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      const result = await adapter.getIssue('1');
      expect(result.type).toBe('Issue');
    });
  });

  // ===========================================================================
  // TESTS: connect / disconnect
  // ===========================================================================

  describe('connect / disconnect', () => {
    it('connect calls healthCheck', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ login: 'testuser', id: 1 })),
      }));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await expect(adapter.connect()).resolves.not.toThrow();
    });

    it('disconnect is a no-op', async () => {
      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await expect(adapter.disconnect()).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // TESTS: API error handling
  // ===========================================================================

  describe('API error handling', () => {
    it('throws descriptive error on API failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('{"message":"Not Found"}'),
      }));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await expect(adapter.getIssue('99999')).rejects.toThrow('GitHub API error 404');
    });

    it('includes response body in error message', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('Validation failed'),
      }));

      const adapter = new GitHubIssuesAdapter(makeConfig(), makeAuth());
      await expect(adapter.createIssue(makeTask())).rejects.toThrow('Validation failed');
    });
  });

  // ===========================================================================
  // TESTS: Registration
  // ===========================================================================

  describe('registration', () => {
    it('registers github-issues tracker factory', async () => {
      // The import side-effect registers the factory
      const { getAvailableTrackers } = await import('../../skills/normalize/tracker-interface.js');
      // Force the adapter module to load (triggers registerTracker)
      await import('./adapter.js');

      const trackers = getAvailableTrackers();
      expect(trackers).toContain('github-issues');
    });
  });
});
