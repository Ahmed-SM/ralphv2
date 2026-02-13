/**
 * Linear Adapter
 *
 * Implements the Tracker interface for Linear via GraphQL API.
 * Supports issues, projects (epics), sub-issues, labels, and state transitions.
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
// LINEAR ADAPTER
// =============================================================================

export class LinearAdapter implements Tracker {
  readonly name = 'linear';

  private config: TrackerConfig;
  private auth: AuthConfig;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: TrackerConfig, auth: AuthConfig) {
    this.config = config;
    this.auth = auth;
    this.baseUrl = config.baseUrl || 'https://api.linear.app';

    if (!config.project) {
      throw new Error('Linear adapter requires a project (team key) in config');
    }

    this.headers = this.buildHeaders();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.auth.type === 'token' && this.auth.token) {
      headers['Authorization'] = this.auth.token;
    } else if (this.auth.type === 'oauth' && this.auth.accessToken) {
      headers['Authorization'] = `Bearer ${this.auth.accessToken}`;
    }

    return headers;
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const body = { query, variables };

    if (this.config.dryRun) {
      // For mutations, return mock data
      const isMutation = query.trimStart().startsWith('mutation');
      if (isMutation) {
        console.log(`[DRY RUN] GraphQL mutation`);
        console.log(`[DRY RUN] Variables:`, JSON.stringify(variables, null, 2));
        return this.dryRunResponse(query) as T;
      }
    }

    const response = await fetch(`${this.baseUrl}/graphql`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Linear API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as GraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Linear GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
    }

    return result.data as T;
  }

  private dryRunResponse(query: string): unknown {
    const now = new Date().toISOString();
    if (query.includes('issueCreate')) {
      return {
        issueCreate: {
          success: true,
          issue: {
            id: 'dry-run-id',
            identifier: `${this.config.project}-0`,
            title: 'dry-run',
            description: '',
            url: `https://linear.app/team/issue/${this.config.project}-0`,
            state: { name: 'Backlog', type: 'backlog' },
            labels: { nodes: [] },
            assignee: null,
            parent: null,
            children: { nodes: [] },
            project: null,
            createdAt: now,
            updatedAt: now,
          },
        },
      };
    }
    if (query.includes('issueUpdate')) {
      return { issueUpdate: { success: true } };
    }
    if (query.includes('projectCreate')) {
      return {
        projectCreate: {
          success: true,
          project: {
            id: 'dry-run-project-id',
            name: 'dry-run',
            description: '',
            url: `https://linear.app/team/project/dry-run`,
            state: 'planned',
            createdAt: now,
            updatedAt: now,
          },
        },
      };
    }
    if (query.includes('commentCreate')) {
      return { commentCreate: { success: true } };
    }
    if (query.includes('issueRelationCreate')) {
      return { issueRelationCreate: { success: true } };
    }
    return {};
  }

  // ===========================================================================
  // CONNECTION
  // ===========================================================================

  async connect(): Promise<void> {
    await this.healthCheck();
  }

  async disconnect(): Promise<void> {
    // No-op for GraphQL API
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();

    try {
      await this.graphql<{ viewer: LinearUser }>(
        `query { viewer { id name email } }`
      );
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
    // If task is an epic, create a project instead
    if (task.type === 'epic') {
      return this.createProject(task);
    }

    const issueData = taskToIssue(task, this.config);
    const labelIds = await this.resolveLabelIds(task);

    const variables: Record<string, unknown> = {
      teamId: this.config.project,
      title: issueData.title || task.title,
      description: issueData.description || '',
    };

    if (labelIds.length > 0) {
      variables.labelIds = labelIds;
    }

    // If task has a parent epic, find the project
    if (task.parent) {
      const projectId = await this.findProjectByName(task.parent);
      if (projectId) {
        variables.projectId = projectId;
      }
    }

    const data = await this.graphql<{ issueCreate: { success: boolean; issue: LinearIssue } }>(
      `mutation IssueCreate($teamId: String!, $title: String!, $description: String, $labelIds: [String!], $projectId: String) {
        issueCreate(input: {
          teamId: $teamId
          title: $title
          description: $description
          labelIds: $labelIds
          projectId: $projectId
        }) {
          success
          issue {
            ${ISSUE_FRAGMENT}
          }
        }
      }`,
      variables
    );

    if (!data.issueCreate.success) {
      throw new Error('Linear issue creation failed');
    }

    return this.mapLinearToExternal(data.issueCreate.issue);
  }

  async updateIssue(externalId: string, changes: IssueChanges): Promise<void> {
    const input: Record<string, unknown> = {};

    if (changes.title) {
      input.title = changes.title;
    }

    if (changes.description) {
      input.description = changes.description;
    }

    if (changes.assignee) {
      input.assigneeId = changes.assignee;
    }

    if (changes.labels) {
      const labelIds = await this.resolveLabelIdsByName(changes.labels);
      if (labelIds.length > 0) {
        input.labelIds = labelIds;
      }
    }

    if (changes.status) {
      const stateId = await this.resolveStateId(changes.status);
      if (stateId) {
        input.stateId = stateId;
      }
    }

    if (Object.keys(input).length > 0) {
      await this.graphql(
        `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
          }
        }`,
        { id: externalId, input }
      );
    }
  }

  async getIssue(externalId: string): Promise<ExternalIssue> {
    const data = await this.graphql<{ issue: LinearIssue }>(
      `query GetIssue($id: String!) {
        issue(id: $id) {
          ${ISSUE_FRAGMENT}
        }
      }`,
      { id: externalId }
    );

    return this.mapLinearToExternal(data.issue);
  }

  async findIssues(query: IssueQuery): Promise<ExternalIssue[]> {
    const filter: Record<string, unknown> = {};

    if (query.assignee) {
      filter.assignee = { displayName: { eq: query.assignee } };
    }

    if (query.updatedSince) {
      filter.updatedAt = { gte: query.updatedSince };
    }

    if (query.status && query.status.length > 0) {
      filter.state = { name: { in: query.status } };
    }

    if (query.type && query.type.length > 0) {
      filter.labels = { name: { in: query.type } };
    }

    const maxResults = query.maxResults || 50;

    const data = await this.graphql<{ issues: { nodes: LinearIssue[] } }>(
      `query FindIssues($teamId: String!, $filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first) {
          nodes {
            ${ISSUE_FRAGMENT}
          }
        }
      }`,
      {
        teamId: this.config.project,
        filter: { ...filter, team: { key: { eq: this.config.project } } },
        first: maxResults,
      }
    );

    return data.issues.nodes.map(issue => this.mapLinearToExternal(issue));
  }

  // ===========================================================================
  // SUBTASKS & LINKS
  // ===========================================================================

  async createSubtask(parentId: string, task: Task): Promise<ExternalIssue> {
    const issueData = taskToIssue(task, this.config);
    const labelIds = await this.resolveLabelIds(task);

    const variables: Record<string, unknown> = {
      teamId: this.config.project,
      title: issueData.title || task.title,
      description: issueData.description || '',
      parentId,
    };

    if (labelIds.length > 0) {
      variables.labelIds = labelIds;
    }

    const data = await this.graphql<{ issueCreate: { success: boolean; issue: LinearIssue } }>(
      `mutation CreateSubIssue($teamId: String!, $title: String!, $description: String, $parentId: String, $labelIds: [String!]) {
        issueCreate(input: {
          teamId: $teamId
          title: $title
          description: $description
          parentId: $parentId
          labelIds: $labelIds
        }) {
          success
          issue {
            ${ISSUE_FRAGMENT}
          }
        }
      }`,
      variables
    );

    if (!data.issueCreate.success) {
      throw new Error('Linear sub-issue creation failed');
    }

    return this.mapLinearToExternal(data.issueCreate.issue);
  }

  async linkIssues(fromId: string, toId: string, linkType: LinkType): Promise<void> {
    const linearRelationType = this.mapLinkTypeToRelation(linkType);

    await this.graphql(
      `mutation CreateRelation($issueId: String!, $relatedIssueId: String!, $type: IssueRelationType!) {
        issueRelationCreate(input: {
          issueId: $issueId
          relatedIssueId: $relatedIssueId
          type: $type
        }) {
          success
        }
      }`,
      {
        issueId: fromId,
        relatedIssueId: toId,
        type: linearRelationType,
      }
    );
  }

  // ===========================================================================
  // TRANSITIONS
  // ===========================================================================

  async transitionIssue(externalId: string, status: string): Promise<void> {
    const stateId = await this.resolveStateId(status);

    if (!stateId) {
      console.warn(`No Linear state found matching "${status}" for team ${this.config.project}`);
      return;
    }

    await this.graphql(
      `mutation TransitionIssue($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
        }
      }`,
      { id: externalId, stateId }
    );
  }

  async getTransitions(_externalId: string): Promise<Transition[]> {
    const data = await this.graphql<{ workflowStates: { nodes: LinearWorkflowState[] } }>(
      `query GetStates($teamId: String!) {
        workflowStates(filter: { team: { key: { eq: $teamId } } }) {
          nodes {
            id
            name
            type
            position
          }
        }
      }`,
      { teamId: this.config.project }
    );

    return data.workflowStates.nodes
      .sort((a, b) => a.position - b.position)
      .map(state => ({
        id: state.id,
        name: state.name,
        to: state.name,
      }));
  }

  // ===========================================================================
  // COMMENTS
  // ===========================================================================

  async addComment(externalId: string, body: string): Promise<void> {
    await this.graphql(
      `mutation AddComment($issueId: String!, $body: String!) {
        commentCreate(input: {
          issueId: $issueId
          body: $body
        }) {
          success
        }
      }`,
      { issueId: externalId, body }
    );
  }

  // ===========================================================================
  // PROJECTS (for epics)
  // ===========================================================================

  private async createProject(task: Task): Promise<ExternalIssue> {
    const description = formatDescription(task);

    const data = await this.graphql<{ projectCreate: { success: boolean; project: LinearProject } }>(
      `mutation CreateProject($name: String!, $description: String, $teamIds: [String!]!) {
        projectCreate(input: {
          name: $name
          description: $description
          teamIds: $teamIds
        }) {
          success
          project {
            id
            name
            description
            url
            state
            createdAt
            updatedAt
          }
        }
      }`,
      {
        name: task.title,
        description,
        teamIds: [this.config.project],
      }
    );

    if (!data.projectCreate.success) {
      throw new Error('Linear project creation failed');
    }

    return this.mapProjectToExternal(data.projectCreate.project);
  }

  private async findProjectByName(name: string): Promise<string | null> {
    try {
      const data = await this.graphql<{ projects: { nodes: LinearProject[] } }>(
        `query FindProject($name: String!) {
          projects(filter: { name: { eq: $name } }) {
            nodes {
              id
              name
            }
          }
        }`,
        { name }
      );

      if (data.projects.nodes.length > 0) {
        return data.projects.nodes[0].id;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private mapLinearToExternal(issue: LinearIssue): ExternalIssue {
    return {
      id: issue.id,
      key: issue.identifier,
      url: issue.url,
      title: issue.title,
      description: issue.description || '',
      status: issue.state?.name || 'Unknown',
      type: this.inferTypeFromLabels(issue.labels?.nodes || []),
      parent: issue.parent?.id,
      subtasks: issue.children?.nodes?.map(c => c.id),
      labels: issue.labels?.nodes?.map(l => l.name) || [],
      assignee: issue.assignee?.displayName,
      created: issue.createdAt,
      updated: issue.updatedAt,
    };
  }

  private mapProjectToExternal(project: LinearProject): ExternalIssue {
    return {
      id: project.id,
      key: `project:${project.name}`,
      url: project.url,
      title: project.name,
      description: project.description || '',
      status: project.state,
      type: 'Project',
      created: project.createdAt,
      updated: project.updatedAt,
    };
  }

  private inferTypeFromLabels(labels: LinearLabel[]): string {
    const labelNames = labels.map(l => l.name.toLowerCase());

    if (labelNames.includes('bug')) return 'Bug';
    if (labelNames.includes('feature')) return 'Feature';
    if (labelNames.includes('improvement')) return 'Improvement';

    return 'Issue';
  }

  private mapLinkTypeToRelation(linkType: LinkType): string {
    const mapping: Record<LinkType, string> = {
      'blocks': 'blocks',
      'is-blocked-by': 'blocks', // reversed in Linear
      'relates-to': 'related',
      'duplicates': 'duplicate',
      'parent-of': 'blocks',
      'child-of': 'blocks',
    };
    return mapping[linkType] || 'related';
  }

  private async resolveLabelIds(task: Task): Promise<string[]> {
    const labelNames: string[] = [];

    // Add type label from config mapping
    const typeLabel = this.config.issueTypeMap[task.type];
    if (typeLabel) {
      labelNames.push(typeLabel);
    }

    // Add task tags
    if (task.tags) {
      labelNames.push(...task.tags);
    }

    if (labelNames.length === 0) {
      return [];
    }

    return this.resolveLabelIdsByName(labelNames);
  }

  private async resolveLabelIdsByName(names: string[]): Promise<string[]> {
    if (names.length === 0) return [];

    try {
      const data = await this.graphql<{ issueLabels: { nodes: LinearLabel[] } }>(
        `query GetLabels {
          issueLabels {
            nodes {
              id
              name
            }
          }
        }`
      );

      const labelMap = new Map(
        data.issueLabels.nodes.map(l => [l.name.toLowerCase(), l.id])
      );

      return names
        .map(n => labelMap.get(n.toLowerCase()))
        .filter((id): id is string => id !== undefined);
    } catch {
      return [];
    }
  }

  private async resolveStateId(statusName: string): Promise<string | null> {
    try {
      const data = await this.graphql<{ workflowStates: { nodes: LinearWorkflowState[] } }>(
        `query GetStates($teamId: String!) {
          workflowStates(filter: { team: { key: { eq: $teamId } } }) {
            nodes {
              id
              name
              type
            }
          }
        }`,
        { teamId: this.config.project }
      );

      const lower = statusName.toLowerCase();
      const match = data.workflowStates.nodes.find(
        s => s.name.toLowerCase() === lower || s.type.toLowerCase() === lower
      );

      return match ? match.id : null;
    } catch {
      return null;
    }
  }
}

// =============================================================================
// GRAPHQL FRAGMENT
// =============================================================================

const ISSUE_FRAGMENT = `
  id
  identifier
  title
  description
  url
  state {
    name
    type
  }
  labels {
    nodes {
      id
      name
    }
  }
  assignee {
    id
    displayName
  }
  parent {
    id
    identifier
  }
  children {
    nodes {
      id
      identifier
    }
  }
  project {
    id
    name
  }
  createdAt
  updatedAt
`;

// =============================================================================
// LINEAR API TYPES
// =============================================================================

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}

interface LinearUser {
  id: string;
  name: string;
  email: string;
}

interface LinearLabel {
  id: string;
  name: string;
}

interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
  position: number;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string } | null;
  labels: { nodes: LinearLabel[] } | null;
  assignee: { id: string; displayName: string } | null;
  parent: { id: string; identifier: string } | null;
  children: { nodes: Array<{ id: string; identifier: string }> } | null;
  project: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface LinearProject {
  id: string;
  name: string;
  description: string | null;
  url: string;
  state: string;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// REGISTER ADAPTER
// =============================================================================

registerTracker('linear', async (config, auth) => {
  const adapter = new LinearAdapter(config, auth);
  await adapter.connect();
  return adapter;
});

export default LinearAdapter;
