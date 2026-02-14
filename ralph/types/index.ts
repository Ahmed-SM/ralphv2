/**
 * Ralph Type Definitions
 *
 * Central type definitions for the Ralph Agentic Delivery OS.
 * See specs/*.md for detailed documentation.
 */

// =============================================================================
// TASK TYPES
// =============================================================================

export type TaskType =
  | 'epic'
  | 'feature'
  | 'task'
  | 'subtask'
  | 'bug'
  | 'refactor'
  | 'docs'
  | 'test'
  | 'spike';

export type TaskStatus =
  | 'discovered'
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'cancelled';

export type Complexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'unknown';

export interface SourceInfo {
  type: 'spec' | 'commit' | 'pr' | 'manual' | 'inferred';
  path?: string;
  line?: number;
  sha?: string;
  timestamp: string;
}

export interface Task {
  // Identity
  id: string;
  externalId?: string;
  externalUrl?: string;

  // Classification
  type: TaskType;
  aggregate?: string;
  domain?: string;

  // Content
  title: string;
  description: string;
  spec?: string;
  source?: SourceInfo;

  // Hierarchy
  parent?: string;
  subtasks?: string[];
  blocks?: string[];
  blockedBy?: string[];

  // State
  status: TaskStatus;
  assignee?: string;

  // Tracking
  createdAt: string;
  updatedAt: string;
  completedAt?: string;

  // Learning
  estimate?: number;
  actual?: number;
  complexity?: Complexity;
  tags?: string[];
}

// =============================================================================
// TASK LOG OPERATIONS
// =============================================================================

export type TaskOperation =
  | TaskCreateOp
  | TaskUpdateOp
  | TaskLinkOp
  | TaskRelateOp;

export interface TaskCreateOp {
  op: 'create';
  task: Task;
  timestamp: string;
}

export interface TaskUpdateOp {
  op: 'update';
  id: string;
  changes: Partial<Task>;
  source?: 'agent' | 'tracker' | 'git' | 'manual';
  timestamp: string;
}

export interface TaskLinkOp {
  op: 'link';
  id: string;
  externalId: string;
  externalUrl?: string;
  timestamp: string;
}

export interface TaskRelateOp {
  op: 'relate';
  id: string;
  relation: 'blocks' | 'blockedBy' | 'parent' | 'subtask';
  targetId: string;
  timestamp: string;
}

// =============================================================================
// TRACKER TYPES
// =============================================================================

export interface TrackerConfig {
  type: 'jira' | 'github-issues' | 'linear';
  baseUrl?: string;
  project: string;
  issueTypeMap: Record<TaskType, string>;
  statusMap: Record<TaskStatus, string>;
  autoCreate: boolean;
  autoTransition: boolean;
  autoComment: boolean;
}

export interface ExternalIssue {
  id: string;
  key: string;
  url: string;
  title: string;
  description: string;
  status: string;
  type: string;
  parent?: string;
  subtasks?: string[];
  created: string;
  updated: string;
}

export interface Tracker {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  createIssue(task: Task): Promise<ExternalIssue>;
  updateIssue(id: string, changes: Partial<Task>): Promise<void>;
  getIssue(id: string): Promise<ExternalIssue>;
  findIssues(query: IssueQuery): Promise<ExternalIssue[]>;
  createSubtask(parentId: string, task: Task): Promise<ExternalIssue>;
  linkIssues(from: string, to: string, type: string): Promise<void>;
  transitionIssue(id: string, status: string): Promise<void>;
  getTransitions(id: string): Promise<Transition[]>;
  addComment(id: string, body: string): Promise<void>;
}

export interface IssueQuery {
  project?: string;
  status?: string[];
  type?: string[];
  assignee?: string;
  updatedSince?: string;
}

export interface Transition {
  id: string;
  name: string;
  to: string;
}

// =============================================================================
// LEARNING TYPES
// =============================================================================

export type LearningEvent =
  | TaskCompletedEvent
  | PatternDetectedEvent
  | ImprovementProposedEvent
  | ImprovementAppliedEvent
  | AnomalyDetectedEvent;

export interface TaskCompletedEvent {
  type: 'task_completed';
  taskId: string;
  estimate?: number;
  actual: number;
  iterations: number;
  taskType: TaskType;
  complexity?: Complexity;
  filesChanged: number;
  linesChanged: number;
  success: boolean;
  blockers?: string[];
  timestamp: string;
}

export type PatternType =
  | 'estimation_drift'
  | 'task_clustering'
  | 'blocking_chain'
  | 'complexity_signal'
  | 'bug_hotspot'
  | 'test_gap'
  | 'high_churn'
  | 'coupling'
  | 'iteration_anomaly'
  | 'failure_mode';

export interface PatternDetectedEvent {
  type: 'pattern_detected';
  pattern: PatternType;
  confidence: number;
  data: Record<string, unknown>;
  evidence: string[];
  timestamp: string;
}

export interface ImprovementProposedEvent {
  type: 'improvement_proposed';
  id: string;
  target: string;
  section?: string;
  change: string;
  diff?: string;
  rationale: string;
  evidence: string[];
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  timestamp: string;
}

export interface ImprovementAppliedEvent {
  type: 'improvement_applied';
  id: string;
  branch: string;
  commit?: string;
  timestamp: string;
}

export interface AnomalyDetectedEvent {
  type: 'anomaly_detected';
  anomaly: string;
  severity: 'low' | 'medium' | 'high';
  context: Record<string, unknown>;
  timestamp: string;
}

// =============================================================================
// LOOP TYPES
// =============================================================================

export interface LoopHooks {
  onTaskStart?(task: Task): void;
  onIterationStart?(task: Task, iteration: number): void;
  onAction?(action: Action): void;
  onIterationEnd?(task: Task, iteration: number, result: IterationResult): void;
  onTaskEnd?(task: Task, success: boolean): void;
  onAnomaly?(anomaly: AnomalyDetectedEvent): void;
}

export interface LoopConfig {
  maxIterationsPerTask: number;
  maxTimePerTask: number;
  maxCostPerTask: number;
  maxTasksPerRun: number;
  maxCostPerRun: number;
  maxTimePerRun: number;
  onFailure: 'stop' | 'continue' | 'retry';
  parallelism: number;
  dryRun?: boolean;
  taskFilter?: string;
}

export interface Iteration {
  number: number;
  taskState: Task;
  actions: Action[];
  result: IterationResult;
  duration: number;
  timestamp: string;
}

export interface Action {
  type: 'read' | 'write' | 'bash' | 'git' | 'eval';
  target: string;
  input?: unknown;
  output?: unknown;
  duration: number;
  timestamp: string;
}

export type IterationResult =
  | { status: 'continue'; reason: string }
  | { status: 'complete'; artifacts: string[] }
  | { status: 'blocked'; blocker: string }
  | { status: 'failed'; error: string };

// =============================================================================
// SKILL TYPES
// =============================================================================

export interface Skill<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  execute(input: TInput, context: SkillContext): Promise<TOutput>;
}

export interface SkillContext {
  sandbox: Sandbox;
  config: RuntimeConfig;
  logger: Logger;
}

export interface Sandbox {
  bash(command: string): Promise<BashResult>;
  eval(code: string): Promise<unknown>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  flush(): Promise<void>;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// =============================================================================
// LLM TYPES
// =============================================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: LLMUsage;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface LLMProvider {
  chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse>;
}

export interface LLMConfig {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
  costPerInputToken?: number;
  costPerOutputToken?: number;
}

// =============================================================================
// CONFIG TYPES
// =============================================================================

export interface RuntimeConfig {
  planFile: string;
  agentsFile: string;
  loop: LoopConfig;
  sandbox: SandboxConfig;
  tracker: TrackerRuntimeConfig;
  git: GitConfig;
  learning: LearningConfig;
  notifications: NotificationConfig;
  llm?: LLMConfig;
}

export interface SandboxConfig {
  enabled?: boolean;
  timeout: number;
  memory?: number;
  maxCommands?: number;
  allowedPaths?: string[];
  deniedPaths?: string[];
  allowedCommands?: string[];
  deniedCommands?: string[];
  cacheReads?: boolean;
}

export interface TrackerRuntimeConfig {
  type: string;
  configPath: string;
  autoCreate: boolean;
  autoTransition: boolean;
  autoComment: boolean;
}

export interface GitConfig {
  autoCommit: boolean;
  commitPrefix: string;
  branchPrefix: string;
}

export interface LearningConfig {
  enabled: boolean;
  autoApplyImprovements: boolean;
  minConfidence: number;
  retentionDays: number;
}

export interface NotificationConfig {
  onAnomaly: boolean;
  onComplete: boolean;
  channel: 'console' | 'slack' | 'email';
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  $ref?: string;
  [key: string]: unknown;
}

export interface ProgressEvent {
  type: string;
  taskId?: string;
  timestamp: string;
  [key: string]: unknown;
}
