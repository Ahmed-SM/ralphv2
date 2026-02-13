/**
 * GitHub Issues Adapter
 *
 * Implements the Tracker interface for GitHub Issues via the REST API.
 * Supports issues, milestones (epics), labels, and state transitions.
 */

import type { Task } from '../../types/index.js';
import type {
  Tracker,
  TrackerConfig,
  AuthConfig,
  ExternalIssue,
  IssueChanges,
  IssueQuery,
  Transition,
  LinkType,
  HealthCheckResult,
} from '../../skills/normalize/tracker-interface.js';
import { registerTracker, taskToIssue, formatDescription } from '../../skills/normalize/tracker-interface.js';

// =============================================================================
// GITHUB ISSUES ADAPTER
// =============================================================================

export class GitHubIssuesAdapter implements Tracker {
  readonly name = 'github-issues';

  private config: TrackerConfig;
  private auth: AuthConfig;
  private baseUrl: string;
  private owner: string;
  private repo: string;
  private headers: Record<string, string>;

  constructor(config: TrackerConfig, auth: AuthConfig) {
    this.config = config;
    this.auth = auth;
    this.baseUrl = config.baseUrl || 'https://api.github.com';

    // project field is "owner/repo" format
    const parts = config.project.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `GitHub Issues project must be in "owner/repo" format, got: "${config.project}"`
      );
    }
    this.owner = parts[0];
    this.repo = parts[1];
    this.headers = this.buildHeaders();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (this.auth.type === 'token' && this.auth.token) {
      headers['Authorization'] = `Bearer ${this.auth.token}`;
    } else if (this.auth.type === 'oauth' && this.auth.accessToken) {
      headers['Authorization'] = `Bearer ${this.auth.accessToken}`;
    } else if (this.auth.type === 'basic' && this.auth.username && this.auth.password) {
      const encoded = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    }

    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    if (this.config.dryRun && method !== 'GET') {
      console.log(`[DRY RUN] ${method} ${url}`);
      if (body) {
        console.log(`[DRY RUN] Body:`, JSON.stringify(body, null, 2));
      }
      return { id: 0, number: 0, html_url: url, title: 'dry-run', body: '', state: 'open', labels: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as T;
    }

    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${errorText}`);
    }

    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  // ===========================================================================
  // CONNECTION
  // ===========================================================================

  async connect(): Promise<void> {
    await this.healthCheck();
  }

  async disconnect(): Promise<void> {
    // No-op for REST API
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();

    try {
      await this.request<GitHubUser>('GET', '/user');
      return {
        healthy: true,
        latency: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        latency: Date.now() - start,
      };
    }
  }

  // ===========================================================================
  // ISSUES
  // ===========================================================================

  async createIssue(task: Task): Promise<ExternalIssue> {
    const issueData = taskToIssue(task, this.config);

    // Build labels from task type mapping
    const labels = this.buildLabels(task);

    const body: GitHubCreateIssueBody = {
      title: issueData.title || task.title,
      body: issueData.description || '',
      labels,
    };

    // If task is an epic, create a milestone instead
    if (task.type === 'epic') {
      return this.createMilestone(task);
    }

    // If task has a parent that's an epic, try to assign milestone
    if (task.parent) {
      const milestoneNumber = await this.findMilestoneByTitle(task.parent);
      if (milestoneNumber) {
        body.milestone = milestoneNumber;
      }
    }

    const response = await this.request<GitHubIssue>(
      'POST',
      `/repos/${this.owner}/${this.repo}/issues`,
      body
    );

    return this.mapGitHubToExternal(response);
  }

  async updateIssue(externalId: string, changes: IssueChanges): Promise<void> {
    const issueNumber = this.extractIssueNumber(externalId);
    const body: Record<string, unknown> = {};

    if (changes.title) {
      body.title = changes.title;
    }

    if (changes.description) {
      body.body = changes.description;
    }

    if (changes.labels) {
      body.labels = changes.labels;
    }

    if (changes.assignee) {
      body.assignees = [changes.assignee];
    }

    if (Object.keys(body).length > 0) {
      await this.request(
        'PATCH',
        `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
        body
      );
    }

    if (changes.status) {
      await this.transitionIssue(externalId, changes.status);
    }
  }

  async getIssue(externalId: string): Promise<ExternalIssue> {
    const issueNumber = this.extractIssueNumber(externalId);
    const response = await this.request<GitHubIssue>(
      'GET',
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`
    );

    return this.mapGitHubToExternal(response);
  }

  async findIssues(query: IssueQuery): Promise<ExternalIssue[]> {
    const params = new URLSearchParams();

    if (query.status && query.status.length > 0) {
      // GitHub only supports 'open' or 'closed'
      const hasOpen = query.status.some(s =>
        ['open', 'Open', 'To Do', 'In Progress', 'Backlog', 'In Review', 'Blocked', 'Todo'].includes(s)
      );
      const hasClosed = query.status.some(s =>
        ['closed', 'Closed', 'Done', 'Cancelled'].includes(s)
      );

      if (hasOpen && hasClosed) {
        params.set('state', 'all');
      } else if (hasClosed) {
        params.set('state', 'closed');
      } else {
        params.set('state', 'open');
      }
    }

    if (query.type && query.type.length > 0) {
      params.set('labels', query.type.join(','));
    }

    if (query.assignee) {
      params.set('assignee', query.assignee);
    }

    if (query.updatedSince) {
      params.set('since', query.updatedSince);
    }

    const maxResults = query.maxResults || 30;
    params.set('per_page', String(maxResults));

    const response = await this.request<GitHubIssue[]>(
      'GET',
      `/repos/${this.owner}/${this.repo}/issues?${params.toString()}`
    );

    // Filter out pull requests (GitHub API returns PRs in issues endpoint)
    return response
      .filter(issue => !issue.pull_request)
      .map(issue => this.mapGitHubToExternal(issue));
  }

  // ===========================================================================
  // SUBTASKS & LINKS
  // ===========================================================================

  async createSubtask(parentId: string, task: Task): Promise<ExternalIssue> {
    // GitHub doesn't have native subtasks, so we create a separate issue
    // and add a reference in the body
    const parentNumber = this.extractIssueNumber(parentId);
    const issueData = taskToIssue(task, this.config);
    const labels = this.buildLabels(task);

    const body = {
      title: issueData.title || task.title,
      body: `Parent: #${parentNumber}\n\n${issueData.description || ''}`,
      labels,
    };

    const response = await this.request<GitHubIssue>(
      'POST',
      `/repos/${this.owner}/${this.repo}/issues`,
      body
    );

    // Add a comment on the parent referencing the subtask
    if (!this.config.dryRun) {
      await this.addComment(parentId, `Subtask created: #${response.number}`);
    }

    return this.mapGitHubToExternal(response);
  }

  async linkIssues(fromId: string, toId: string, _linkType: LinkType): Promise<void> {
    // GitHub doesn't have native issue linking — add a comment
    const fromNumber = this.extractIssueNumber(fromId);
    const toNumber = this.extractIssueNumber(toId);

    await this.addComment(
      fromId,
      `Linked to #${toNumber} (from #${fromNumber})`
    );
  }

  // ===========================================================================
  // TRANSITIONS
  // ===========================================================================

  async transitionIssue(externalId: string, status: string): Promise<void> {
    const issueNumber = this.extractIssueNumber(externalId);
    const lower = status.toLowerCase();

    // GitHub only has open/closed states
    const shouldClose =
      lower === 'closed' ||
      lower === 'done' ||
      lower === 'cancelled' ||
      lower === 'resolved';

    const state = shouldClose ? 'closed' : 'open';
    const stateReason = lower === 'cancelled' ? 'not_planned' : (shouldClose ? 'completed' : undefined);

    const body: Record<string, unknown> = { state };
    if (stateReason) {
      body.state_reason = stateReason;
    }

    await this.request(
      'PATCH',
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
      body
    );
  }

  async getTransitions(externalId: string): Promise<Transition[]> {
    // GitHub issues have simple open/closed states
    const issue = await this.getIssue(externalId);
    const currentState = issue.status.toLowerCase();

    const transitions: Transition[] = [];

    if (currentState === 'open') {
      transitions.push(
        { id: 'close', name: 'Close', to: 'closed' },
        { id: 'close-not-planned', name: 'Close as not planned', to: 'closed' }
      );
    } else {
      transitions.push(
        { id: 'reopen', name: 'Reopen', to: 'open' }
      );
    }

    return transitions;
  }

  // ===========================================================================
  // COMMENTS
  // ===========================================================================

  async addComment(externalId: string, body: string): Promise<void> {
    const issueNumber = this.extractIssueNumber(externalId);
    await this.request(
      'POST',
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`,
      { body }
    );
  }

  // ===========================================================================
  // MILESTONES (for epics)
  // ===========================================================================

  private async createMilestone(task: Task): Promise<ExternalIssue> {
    const body = {
      title: task.title,
      description: formatDescription(task),
      state: task.status === 'done' ? 'closed' : 'open',
    };

    const response = await this.request<GitHubMilestone>(
      'POST',
      `/repos/${this.owner}/${this.repo}/milestones`,
      body
    );

    return this.mapMilestoneToExternal(response);
  }

  private async findMilestoneByTitle(title: string): Promise<number | null> {
    try {
      const milestones = await this.request<GitHubMilestone[]>(
        'GET',
        `/repos/${this.owner}/${this.repo}/milestones?state=all&per_page=100`
      );

      const match = milestones.find(
        m => m.title.toLowerCase() === title.toLowerCase()
      );
      return match ? match.number : null;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private mapGitHubToExternal(issue: GitHubIssue): ExternalIssue {
    return {
      id: String(issue.id),
      key: `${this.owner}/${this.repo}#${issue.number}`,
      url: issue.html_url,
      title: issue.title,
      description: issue.body || '',
      status: issue.state,
      type: this.inferTypeFromLabels(issue.labels),
      parent: issue.milestone ? String(issue.milestone.number) : undefined,
      labels: issue.labels.map(l => (typeof l === 'string' ? l : l.name)),
      assignee: issue.assignee?.login,
      created: issue.created_at,
      updated: issue.updated_at,
    };
  }

  private mapMilestoneToExternal(milestone: GitHubMilestone): ExternalIssue {
    return {
      id: String(milestone.id),
      key: `${this.owner}/${this.repo}:milestone/${milestone.number}`,
      url: milestone.html_url,
      title: milestone.title,
      description: milestone.description || '',
      status: milestone.state,
      type: 'Milestone',
      created: milestone.created_at,
      updated: milestone.updated_at,
    };
  }

  private inferTypeFromLabels(labels: GitHubLabel[]): string {
    const labelNames = labels.map(l => (typeof l === 'string' ? l : l.name).toLowerCase());

    if (labelNames.includes('bug')) return 'Bug';
    if (labelNames.includes('enhancement')) return 'Enhancement';
    if (labelNames.includes('epic')) return 'Epic';
    if (labelNames.includes('task')) return 'Task';

    return 'Issue';
  }

  private buildLabels(task: Task): string[] {
    const labels: string[] = [];

    // Add type label from config mapping
    const typeLabel = this.config.issueTypeMap[task.type];
    if (typeLabel) {
      labels.push(typeLabel);
    }

    // Add task tags
    if (task.tags) {
      labels.push(...task.tags);
    }

    return labels;
  }

  /**
   * Extract issue number from external ID.
   * Accepts: "123", "owner/repo#123", "#123"
   */
  extractIssueNumber(externalId: string): number {
    // Try "owner/repo#123" format
    const hashMatch = externalId.match(/#(\d+)/);
    if (hashMatch) {
      return parseInt(hashMatch[1], 10);
    }

    // Try plain number
    const num = parseInt(externalId, 10);
    if (!isNaN(num)) {
      return num;
    }

    throw new Error(`Cannot extract issue number from "${externalId}"`);
  }
}

// =============================================================================
// GITHUB API TYPES
// =============================================================================

interface GitHubUser {
  login: string;
  id: number;
}

interface GitHubLabel {
  name: string;
  color?: string;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  labels: GitHubLabel[];
  assignee?: { login: string } | null;
  milestone?: { number: number; title: string } | null;
  pull_request?: unknown;
  created_at: string;
  updated_at: string;
}

interface GitHubMilestone {
  id: number;
  number: number;
  title: string;
  description: string | null;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

interface GitHubCreateIssueBody {
  title: string;
  body: string;
  labels?: string[];
  milestone?: number;
  assignees?: string[];
}

// =============================================================================
// REGISTER ADAPTER
// =============================================================================

registerTracker('github-issues', async (config, auth) => {
  const adapter = new GitHubIssuesAdapter(config, auth);
  await adapter.connect();
  return adapter;
});

export default GitHubIssuesAdapter;
