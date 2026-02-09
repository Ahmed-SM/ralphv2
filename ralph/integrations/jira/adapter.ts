/**
 * Jira Adapter
 *
 * Implements the Tracker interface for Jira Cloud and Data Center.
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
// JIRA ADAPTER
// =============================================================================

export class JiraAdapter implements Tracker {
  readonly name = 'jira';

  private config: TrackerConfig;
  private auth: AuthConfig;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: TrackerConfig, auth: AuthConfig) {
    this.config = config;
    this.auth = auth;
    this.baseUrl = config.baseUrl || 'https://your-domain.atlassian.net';
    this.headers = this.buildHeaders();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.auth.type === 'basic' || this.auth.type === 'token') {
      const credentials = `${this.auth.email || this.auth.username}:${this.auth.token || this.auth.password}`;
      const encoded = Buffer.from(credentials).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    } else if (this.auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${this.auth.accessToken}`;
    }

    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/rest/api/3${path}`;

    if (this.config.dryRun && method !== 'GET') {
      console.log(`[DRY RUN] ${method} ${url}`);
      if (body) {
        console.log(`[DRY RUN] Body:`, JSON.stringify(body, null, 2));
      }
      // Return mock response for dry run
      return { id: 'dry-run', key: 'DRY-1', self: url } as T;
    }

    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira API error ${response.status}: ${errorText}`);
    }

    // Handle empty responses
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
    // Jira REST API is stateless, no connection needed
    // Validate credentials by fetching current user
    await this.healthCheck();
  }

  async disconnect(): Promise<void> {
    // No-op for REST API
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();

    try {
      await this.request<{ accountId: string }>('GET', '/myself');
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

    const body = {
      fields: {
        project: { key: this.config.project },
        issuetype: { name: issueData.type },
        summary: issueData.title,
        description: this.toADF(issueData.description || ''),
        labels: issueData.labels || [],
      },
    };

    // Add parent for subtasks
    if (task.parent && task.type === 'subtask') {
      // Need to get parent's external ID
      // This assumes parent has already been synced
      (body.fields as Record<string, unknown>).parent = { key: task.parent };
    }

    const response = await this.request<JiraCreateResponse>('POST', '/issue', body);

    return this.getIssue(response.key);
  }

  async updateIssue(externalId: string, changes: IssueChanges): Promise<void> {
    const fields: Record<string, unknown> = {};

    if (changes.title) {
      fields.summary = changes.title;
    }

    if (changes.description) {
      fields.description = this.toADF(changes.description);
    }

    if (changes.labels) {
      fields.labels = changes.labels;
    }

    if (changes.assignee) {
      fields.assignee = { accountId: changes.assignee };
    }

    if (Object.keys(fields).length > 0) {
      await this.request('PUT', `/issue/${externalId}`, { fields });
    }

    // Handle status separately via transitions
    if (changes.status) {
      await this.transitionIssue(externalId, changes.status);
    }
  }

  async getIssue(externalId: string): Promise<ExternalIssue> {
    const response = await this.request<JiraIssue>('GET', `/issue/${externalId}`);

    return this.mapJiraToExternal(response);
  }

  async findIssues(query: IssueQuery): Promise<ExternalIssue[]> {
    // Build JQL query
    const jqlParts: string[] = [];

    if (query.project) {
      jqlParts.push(`project = "${query.project}"`);
    } else {
      jqlParts.push(`project = "${this.config.project}"`);
    }

    if (query.status && query.status.length > 0) {
      const statuses = query.status.map(s => `"${s}"`).join(', ');
      jqlParts.push(`status IN (${statuses})`);
    }

    if (query.type && query.type.length > 0) {
      const types = query.type.map(t => `"${t}"`).join(', ');
      jqlParts.push(`issuetype IN (${types})`);
    }

    if (query.assignee) {
      jqlParts.push(`assignee = "${query.assignee}"`);
    }

    if (query.updatedSince) {
      jqlParts.push(`updated >= "${query.updatedSince}"`);
    }

    if (query.query) {
      jqlParts.push(query.query);
    }

    const jql = jqlParts.join(' AND ');
    const maxResults = query.maxResults || 50;

    const response = await this.request<JiraSearchResponse>(
      'GET',
      `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`
    );

    return response.issues.map(issue => this.mapJiraToExternal(issue));
  }

  // ===========================================================================
  // SUBTASKS & LINKS
  // ===========================================================================

  async createSubtask(parentId: string, task: Task): Promise<ExternalIssue> {
    const issueData = taskToIssue(task, this.config);

    const body = {
      fields: {
        project: { key: this.config.project },
        parent: { key: parentId },
        issuetype: { name: this.config.issueTypeMap.subtask || 'Sub-task' },
        summary: issueData.title,
        description: this.toADF(issueData.description || ''),
      },
    };

    const response = await this.request<JiraCreateResponse>('POST', '/issue', body);

    return this.getIssue(response.key);
  }

  async linkIssues(fromId: string, toId: string, linkType: LinkType): Promise<void> {
    const jiraLinkType = this.mapLinkType(linkType);

    const body = {
      type: { name: jiraLinkType },
      inwardIssue: { key: fromId },
      outwardIssue: { key: toId },
    };

    await this.request('POST', '/issueLink', body);
  }

  // ===========================================================================
  // TRANSITIONS
  // ===========================================================================

  async transitionIssue(externalId: string, status: string): Promise<void> {
    // Get available transitions
    const transitions = await this.getTransitions(externalId);

    // Find matching transition
    const transition = transitions.find(
      t => t.name.toLowerCase() === status.toLowerCase() ||
           t.to.toLowerCase() === status.toLowerCase()
    );

    if (!transition) {
      console.warn(`No transition found for status "${status}" on ${externalId}`);
      console.warn(`Available transitions: ${transitions.map(t => t.name).join(', ')}`);
      return;
    }

    await this.request('POST', `/issue/${externalId}/transitions`, {
      transition: { id: transition.id },
    });
  }

  async getTransitions(externalId: string): Promise<Transition[]> {
    const response = await this.request<JiraTransitionsResponse>(
      'GET',
      `/issue/${externalId}/transitions`
    );

    return response.transitions.map(t => ({
      id: t.id,
      name: t.name,
      to: t.to.name,
    }));
  }

  // ===========================================================================
  // COMMENTS
  // ===========================================================================

  async addComment(externalId: string, body: string): Promise<void> {
    await this.request('POST', `/issue/${externalId}/comment`, {
      body: this.toADF(body),
    });
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private mapJiraToExternal(issue: JiraIssue): ExternalIssue {
    return {
      id: issue.id,
      key: issue.key,
      url: `${this.baseUrl}/browse/${issue.key}`,
      title: issue.fields.summary,
      description: this.fromADF(issue.fields.description),
      status: issue.fields.status.name,
      type: issue.fields.issuetype.name,
      parent: issue.fields.parent?.key,
      subtasks: issue.fields.subtasks?.map(s => s.key),
      labels: issue.fields.labels,
      assignee: issue.fields.assignee?.accountId,
      created: issue.fields.created,
      updated: issue.fields.updated,
    };
  }

  private mapLinkType(linkType: LinkType): string {
    const mapping: Record<LinkType, string> = {
      'blocks': 'Blocks',
      'is-blocked-by': 'Blocks', // Jira uses inward/outward
      'relates-to': 'Relates',
      'duplicates': 'Duplicate',
      'parent-of': 'Parent',
      'child-of': 'Parent',
    };
    return mapping[linkType] || 'Relates';
  }

  /**
   * Convert plain text/markdown to Atlassian Document Format (ADF)
   */
  private toADF(text: string): JiraADF {
    // Simple conversion - just paragraphs
    const paragraphs = text.split('\n\n').filter(p => p.trim());

    return {
      type: 'doc',
      version: 1,
      content: paragraphs.map(p => ({
        type: 'paragraph',
        content: [{ type: 'text', text: p.replace(/\n/g, ' ') }],
      })),
    };
  }

  /**
   * Convert ADF back to plain text
   */
  private fromADF(adf: JiraADF | null): string {
    if (!adf || !adf.content) return '';

    const extractText = (node: JiraADFNode): string => {
      if (node.type === 'text') {
        return node.text || '';
      }
      if (node.content) {
        return node.content.map(extractText).join('');
      }
      return '';
    };

    return adf.content.map(extractText).join('\n\n');
  }
}

// =============================================================================
// JIRA API TYPES
// =============================================================================

interface JiraCreateResponse {
  id: string;
  key: string;
  self: string;
}

interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description: JiraADF | null;
    status: { name: string };
    issuetype: { name: string };
    parent?: { key: string };
    subtasks?: Array<{ key: string }>;
    labels: string[];
    assignee?: { accountId: string };
    created: string;
    updated: string;
  };
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
}

interface JiraTransitionsResponse {
  transitions: Array<{
    id: string;
    name: string;
    to: { name: string };
  }>;
}

interface JiraADF {
  type: 'doc';
  version: 1;
  content: JiraADFNode[];
}

interface JiraADFNode {
  type: string;
  text?: string;
  content?: JiraADFNode[];
}

// =============================================================================
// REGISTER ADAPTER
// =============================================================================

registerTracker('jira', async (config, auth) => {
  const adapter = new JiraAdapter(config, auth);
  await adapter.connect();
  return adapter;
});

export default JiraAdapter;
