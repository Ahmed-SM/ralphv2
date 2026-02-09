/**
 * Tracker Interface
 *
 * Abstract interface for issue trackers (Jira, GitHub Issues, Linear, etc.)
 * All tracker adapters must implement this interface.
 */

import type { Task, TaskStatus, TaskType } from '../../types/index.js';

// =============================================================================
// CORE INTERFACES
// =============================================================================

export interface Tracker {
  /** Tracker name (e.g., "jira", "github-issues", "linear") */
  readonly name: string;

  /** Connect to the tracker */
  connect(): Promise<void>;

  /** Disconnect from the tracker */
  disconnect(): Promise<void>;

  /** Check if connection is healthy */
  healthCheck(): Promise<HealthCheckResult>;

  /** Create a new issue from a task */
  createIssue(task: Task): Promise<ExternalIssue>;

  /** Update an existing issue */
  updateIssue(externalId: string, changes: IssueChanges): Promise<void>;

  /** Get an issue by ID */
  getIssue(externalId: string): Promise<ExternalIssue>;

  /** Find issues matching a query */
  findIssues(query: IssueQuery): Promise<ExternalIssue[]>;

  /** Create a subtask under a parent issue */
  createSubtask(parentId: string, task: Task): Promise<ExternalIssue>;

  /** Link two issues together */
  linkIssues(fromId: string, toId: string, linkType: LinkType): Promise<void>;

  /** Transition an issue to a new status */
  transitionIssue(externalId: string, status: string): Promise<void>;

  /** Get available transitions for an issue */
  getTransitions(externalId: string): Promise<Transition[]>;

  /** Add a comment to an issue */
  addComment(externalId: string, body: string): Promise<void>;
}

// =============================================================================
// DATA TYPES
// =============================================================================

export interface ExternalIssue {
  /** Internal tracker ID */
  id: string;
  /** Display key (e.g., "RALPH-123") */
  key: string;
  /** Web URL */
  url: string;

  /** Issue title/summary */
  title: string;
  /** Issue description */
  description: string;
  /** Current status */
  status: string;
  /** Issue type */
  type: string;

  /** Parent issue key (for subtasks) */
  parent?: string;
  /** Subtask keys */
  subtasks?: string[];

  /** Labels/tags */
  labels?: string[];
  /** Assignee */
  assignee?: string;

  /** Timestamps */
  created: string;
  updated: string;
}

export interface IssueChanges {
  title?: string;
  description?: string;
  status?: string;
  type?: string;
  assignee?: string;
  labels?: string[];
  parent?: string;
}

export interface IssueQuery {
  /** Project key */
  project?: string;
  /** Filter by status */
  status?: string[];
  /** Filter by type */
  type?: string[];
  /** Filter by assignee */
  assignee?: string;
  /** Updated since timestamp */
  updatedSince?: string;
  /** Maximum results */
  maxResults?: number;
  /** JQL or native query string */
  query?: string;
}

export interface Transition {
  /** Transition ID */
  id: string;
  /** Transition name */
  name: string;
  /** Target status */
  to: string;
}

export type LinkType = 'blocks' | 'is-blocked-by' | 'relates-to' | 'duplicates' | 'parent-of' | 'child-of';

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  latency?: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface TrackerConfig {
  /** Tracker type */
  type: 'jira' | 'github-issues' | 'linear';

  /** Base URL (for self-hosted) */
  baseUrl?: string;

  /** Project key */
  project: string;

  /** Map Ralph task types to tracker issue types */
  issueTypeMap: Record<TaskType, string>;

  /** Map Ralph status to tracker status */
  statusMap: Record<TaskStatus, string>;

  /** Reverse map: tracker status to Ralph status */
  reverseStatusMap?: Record<string, TaskStatus>;

  /** Auto-create issues */
  autoCreate: boolean;

  /** Auto-transition on status change */
  autoTransition: boolean;

  /** Auto-add comments on activity */
  autoComment: boolean;

  /** Dry run mode (log but don't execute) */
  dryRun?: boolean;
}

export interface AuthConfig {
  type: 'token' | 'basic' | 'oauth';
  email?: string;
  token?: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
}

// =============================================================================
// SYNC TYPES
// =============================================================================

export interface SyncResult {
  /** Tasks processed */
  processed: number;
  /** Issues created */
  created: number;
  /** Issues updated */
  updated: number;
  /** Issues skipped */
  skipped: number;
  /** Errors encountered */
  errors: SyncError[];
  /** Sync duration in ms */
  duration: number;
}

export interface SyncError {
  taskId: string;
  externalId?: string;
  operation: 'create' | 'update' | 'transition' | 'comment';
  error: string;
}

export interface SyncOptions {
  /** Only sync tasks with these IDs */
  taskIds?: string[];
  /** Only sync tasks with these statuses */
  statuses?: TaskStatus[];
  /** Force sync even if up-to-date */
  force?: boolean;
  /** Dry run mode */
  dryRun?: boolean;
}

// =============================================================================
// FACTORY
// =============================================================================

export type TrackerFactory = (config: TrackerConfig, auth: AuthConfig) => Promise<Tracker>;

const trackerFactories = new Map<string, TrackerFactory>();

/**
 * Register a tracker factory
 */
export function registerTracker(type: string, factory: TrackerFactory): void {
  trackerFactories.set(type, factory);
}

/**
 * Create a tracker instance
 */
export async function createTracker(config: TrackerConfig, auth: AuthConfig): Promise<Tracker> {
  const factory = trackerFactories.get(config.type);
  if (!factory) {
    throw new Error(`Unknown tracker type: ${config.type}`);
  }
  return factory(config, auth);
}

/**
 * Get available tracker types
 */
export function getAvailableTrackers(): string[] {
  return Array.from(trackerFactories.keys());
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Map a Ralph task to tracker issue format
 */
export function taskToIssue(task: Task, config: TrackerConfig): Partial<ExternalIssue> {
  return {
    title: task.title,
    description: formatDescription(task),
    type: config.issueTypeMap[task.type] || 'Task',
    status: config.statusMap[task.status] || 'To Do',
    labels: task.tags,
  };
}

/**
 * Format task description for tracker
 */
export function formatDescription(task: Task): string {
  const lines: string[] = [];

  if (task.description) {
    lines.push(task.description);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('**Ralph Task**');
  lines.push(`- ID: ${task.id}`);

  if (task.spec) {
    lines.push(`- Spec: ${task.spec}`);
  }

  if (task.source) {
    lines.push(`- Source: ${task.source.path}:${task.source.line}`);
  }

  lines.push(`- Created: ${task.createdAt}`);
  lines.push('');
  lines.push('_Managed by Ralph. Do not edit this section._');

  return lines.join('\n');
}

/**
 * Map tracker status back to Ralph status
 */
export function mapStatusToRalph(trackerStatus: string, config: TrackerConfig): TaskStatus {
  // Check reverse map first
  if (config.reverseStatusMap?.[trackerStatus]) {
    return config.reverseStatusMap[trackerStatus];
  }

  // Try to find in forward map
  for (const [ralphStatus, mappedStatus] of Object.entries(config.statusMap)) {
    if (mappedStatus.toLowerCase() === trackerStatus.toLowerCase()) {
      return ralphStatus as TaskStatus;
    }
  }

  // Default mapping based on common names
  const lower = trackerStatus.toLowerCase();
  if (lower.includes('done') || lower.includes('closed') || lower.includes('resolved')) {
    return 'done';
  }
  if (lower.includes('progress') || lower.includes('active')) {
    return 'in_progress';
  }
  if (lower.includes('review')) {
    return 'review';
  }
  if (lower.includes('block')) {
    return 'blocked';
  }

  return 'pending';
}
