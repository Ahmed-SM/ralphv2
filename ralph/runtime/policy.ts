/**
 * Policy Engine
 *
 * Enforces safety policies for Ralph delivery runs.
 * See specs/policy-engine.md for the full specification.
 */

import { resolve, relative } from 'path';
import type {
  RalphPolicy,
  RalphMode,
  ApprovalClass,
  CheckType,
  PolicyViolation,
  PolicyCheckResult,
  PolicyViolationType,
  ProgressEvent,
} from '../types/index.js';

// =============================================================================
// POLICY LOADING & VALIDATION
// =============================================================================

/**
 * Load a policy file from disk.
 * Returns null if the file doesn't exist or is invalid.
 */
export async function loadPolicy(
  policyPath: string,
  readFile: (path: string, encoding: 'utf-8') => Promise<string>,
): Promise<RalphPolicy | null> {
  try {
    const content = await readFile(policyPath, 'utf-8');
    const parsed = JSON.parse(content);
    const errors = validatePolicy(parsed);
    if (errors.length > 0) {
      console.warn(`Policy validation errors in ${policyPath}:`, errors);
      return null;
    }
    return parsed as RalphPolicy;
  } catch {
    return null;
  }
}

/**
 * Validate a policy object against the schema.
 * Returns an array of error messages (empty if valid).
 */
export function validatePolicy(policy: unknown): string[] {
  const errors: string[] = [];

  if (!policy || typeof policy !== 'object') {
    return ['Policy must be a non-null object'];
  }

  const p = policy as Record<string, unknown>;

  // version
  if (typeof p.version !== 'number' || p.version < 1) {
    errors.push('version must be a positive number');
  }

  // mode
  if (p.mode !== 'core' && p.mode !== 'delivery') {
    errors.push('mode must be "core" or "delivery"');
  }

  // files
  if (!p.files || typeof p.files !== 'object') {
    errors.push('files must be an object');
  } else {
    const f = p.files as Record<string, unknown>;
    for (const key of ['allowRead', 'allowWrite', 'denyRead', 'denyWrite']) {
      if (!Array.isArray(f[key])) {
        errors.push(`files.${key} must be an array`);
      }
    }
  }

  // commands
  if (!p.commands || typeof p.commands !== 'object') {
    errors.push('commands must be an object');
  } else {
    const c = p.commands as Record<string, unknown>;
    if (!Array.isArray(c.allow)) errors.push('commands.allow must be an array');
    if (!Array.isArray(c.deny)) errors.push('commands.deny must be an array');
  }

  // approval
  if (!p.approval || typeof p.approval !== 'object') {
    errors.push('approval must be an object');
  } else {
    const a = p.approval as Record<string, unknown>;
    if (!Array.isArray(a.requiredFor)) {
      errors.push('approval.requiredFor must be an array');
    } else {
      const validClasses: ApprovalClass[] = ['destructive_ops', 'dependency_changes', 'production_impacting_edits'];
      for (const item of a.requiredFor as string[]) {
        if (!validClasses.includes(item as ApprovalClass)) {
          errors.push(`approval.requiredFor contains invalid class: ${item}`);
        }
      }
    }
    if (typeof a.requireReason !== 'boolean') {
      errors.push('approval.requireReason must be a boolean');
    }
  }

  // checks
  if (!p.checks || typeof p.checks !== 'object') {
    errors.push('checks must be an object');
  } else {
    const ch = p.checks as Record<string, unknown>;
    if (!Array.isArray(ch.required)) {
      errors.push('checks.required must be an array');
    } else {
      const validChecks: CheckType[] = ['test', 'build', 'lint', 'typecheck'];
      for (const item of ch.required as string[]) {
        if (!validChecks.includes(item as CheckType)) {
          errors.push(`checks.required contains invalid check: ${item}`);
        }
      }
    }
    if (typeof ch.rollbackOnFail !== 'boolean') {
      errors.push('checks.rollbackOnFail must be a boolean');
    }
  }

  return errors;
}

// =============================================================================
// FILE ACCESS CHECKS
// =============================================================================

/**
 * Check if reading a file is allowed by the policy.
 */
export function checkFileRead(
  policy: RalphPolicy,
  filePath: string,
  workDir: string,
): PolicyCheckResult {
  const relPath = toRelativePath(filePath, workDir);

  // Check deny list first (deny wins)
  for (const denied of policy.files.denyRead) {
    if (pathMatches(relPath, denied)) {
      return {
        allowed: false,
        violation: makeViolation('file_read_denied', filePath, `denyRead: ${denied}`),
      };
    }
  }

  // Check allow list
  for (const allowed of policy.files.allowRead) {
    if (pathMatches(relPath, allowed)) {
      return { allowed: true };
    }
  }

  // In delivery mode, non-allowlisted reads are blocked
  if (policy.mode === 'delivery') {
    return {
      allowed: false,
      violation: makeViolation('file_read_denied', filePath, 'not in allowRead list (delivery mode)'),
    };
  }

  // Core mode: default allow
  return { allowed: true };
}

/**
 * Check if writing a file is allowed by the policy.
 */
export function checkFileWrite(
  policy: RalphPolicy,
  filePath: string,
  workDir: string,
): PolicyCheckResult {
  const relPath = toRelativePath(filePath, workDir);

  // Check deny list first
  for (const denied of policy.files.denyWrite) {
    if (pathMatches(relPath, denied)) {
      return {
        allowed: false,
        violation: makeViolation('file_write_denied', filePath, `denyWrite: ${denied}`),
      };
    }
  }

  // Check allow list
  for (const allowed of policy.files.allowWrite) {
    if (pathMatches(relPath, allowed)) {
      return { allowed: true };
    }
  }

  // In delivery mode, non-allowlisted writes are blocked
  if (policy.mode === 'delivery') {
    return {
      allowed: false,
      violation: makeViolation('file_write_denied', filePath, 'not in allowWrite list (delivery mode)'),
    };
  }

  // Core mode: default allow
  return { allowed: true };
}

// =============================================================================
// COMMAND ACCESS CHECKS
// =============================================================================

/**
 * Check if a command is allowed by the policy.
 */
export function checkCommand(
  policy: RalphPolicy,
  command: string,
): PolicyCheckResult {
  // Check deny list first
  for (const denied of policy.commands.deny) {
    if (commandMatches(command, denied)) {
      return {
        allowed: false,
        violation: makeViolation('command_denied', command, `deny: ${denied}`),
      };
    }
  }

  // Check allow list
  for (const allowed of policy.commands.allow) {
    if (commandMatches(command, allowed)) {
      return { allowed: true };
    }
  }

  // In delivery mode, non-allowlisted commands are blocked
  if (policy.mode === 'delivery') {
    return {
      allowed: false,
      violation: makeViolation('command_denied', command, 'not in allow list (delivery mode)'),
    };
  }

  // Core mode: default allow
  return { allowed: true };
}

// =============================================================================
// ACTION CLASSIFICATION & APPROVAL
// =============================================================================

/** Patterns for destructive operations */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[rf]+\s+)?/,
  /\bgit\s+(reset|clean|checkout\s+--)\b/,
  /\bgit\s+push\s+--force\b/,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
];

/** Patterns for dependency changes */
const DEPENDENCY_PATTERNS = [
  /\bnpm\s+(install|uninstall|update|add|remove)\b/,
  /\byarn\s+(add|remove|upgrade)\b/,
  /\bpnpm\s+(add|remove|update|install)\b/,
  /\bpip\s+(install|uninstall)\b/,
  /\bcargo\s+(add|remove)\b/,
  /package\.json/,
  /package-lock\.json/,
  /yarn\.lock/,
  /pnpm-lock\.yaml/,
];

/** Patterns for production-impacting edits */
const PRODUCTION_PATTERNS = [
  /\b(deploy|release|publish)\b/,
  /Dockerfile/,
  /docker-compose/,
  /\.github\/workflows/,
  /\.env\.production/,
  /infrastructure\//,
  /terraform\//,
  /k8s\//,
  /kubernetes\//,
];

/**
 * Classify an action (command or file path) into approval classes.
 * Returns all matching classes.
 */
export function classifyAction(action: string): ApprovalClass[] {
  const classes: ApprovalClass[] = [];

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(action)) {
      classes.push('destructive_ops');
      break;
    }
  }

  for (const pattern of DEPENDENCY_PATTERNS) {
    if (pattern.test(action)) {
      classes.push('dependency_changes');
      break;
    }
  }

  for (const pattern of PRODUCTION_PATTERNS) {
    if (pattern.test(action)) {
      classes.push('production_impacting_edits');
      break;
    }
  }

  return classes;
}

/**
 * Check if an action requires human approval per policy.
 */
export function requiresApproval(
  policy: RalphPolicy,
  action: string,
): PolicyCheckResult {
  const classes = classifyAction(action);
  const matchingClasses = classes.filter(c => policy.approval.requiredFor.includes(c));

  if (matchingClasses.length > 0) {
    return {
      allowed: true,
      requiresApproval: true,
      approvalClass: matchingClasses[0],
      violation: makeViolation('approval_required', action, `requires approval: ${matchingClasses.join(', ')}`),
    };
  }

  return { allowed: true, requiresApproval: false };
}

// =============================================================================
// REQUIRED CHECKS
// =============================================================================

export interface CheckRunner {
  bash(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface CheckResult {
  check: CheckType;
  passed: boolean;
  output: string;
  duration: number;
}

/**
 * Run the required checks defined in the policy.
 * Returns results for each check.
 */
export async function runRequiredChecks(
  policy: RalphPolicy,
  commands: Record<string, string>,
  runner: CheckRunner,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const check of policy.checks.required) {
    const command = commands[check];
    if (!command) {
      results.push({
        check,
        passed: false,
        output: `No command configured for check: ${check}`,
        duration: 0,
      });
      continue;
    }

    const start = Date.now();
    try {
      const result = await runner.bash(command);
      results.push({
        check,
        passed: result.exitCode === 0,
        output: result.stdout || result.stderr,
        duration: Date.now() - start,
      });
    } catch (error) {
      results.push({
        check,
        passed: false,
        output: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      });
    }
  }

  return results;
}

/**
 * Check if all required checks passed.
 */
export function allChecksPassed(results: CheckResult[]): boolean {
  return results.length > 0 && results.every(r => r.passed);
}

// =============================================================================
// VIOLATION LOGGING
// =============================================================================

/**
 * Create a policy violation progress event for logging.
 */
export function createViolationEvent(
  violation: PolicyViolation,
  taskId?: string,
): ProgressEvent {
  return {
    type: 'policy_violation',
    taskId,
    violationType: violation.type,
    target: violation.target,
    rule: violation.rule,
    timestamp: violation.timestamp,
  };
}

/**
 * Convenience: Enforce file read against policy with violation logging.
 * Returns the check result and any violation event.
 */
export function enforceFileRead(
  policy: RalphPolicy,
  filePath: string,
  workDir: string,
): { result: PolicyCheckResult; event?: ProgressEvent } {
  const result = checkFileRead(policy, filePath, workDir);
  const event = result.violation ? createViolationEvent(result.violation) : undefined;
  return { result, event };
}

/**
 * Convenience: Enforce file write against policy with violation logging.
 */
export function enforceFileWrite(
  policy: RalphPolicy,
  filePath: string,
  workDir: string,
): { result: PolicyCheckResult; event?: ProgressEvent } {
  const result = checkFileWrite(policy, filePath, workDir);
  const event = result.violation ? createViolationEvent(result.violation) : undefined;
  return { result, event };
}

/**
 * Convenience: Enforce command against policy with violation logging.
 */
export function enforceCommand(
  policy: RalphPolicy,
  command: string,
): { result: PolicyCheckResult; event?: ProgressEvent } {
  const result = checkCommand(policy, command);
  const event = result.violation ? createViolationEvent(result.violation) : undefined;
  return { result, event };
}

// =============================================================================
// DEFAULT POLICY
// =============================================================================

/**
 * Returns a minimal default policy (permissive core mode).
 */
export function defaultPolicy(): RalphPolicy {
  return {
    version: 1,
    mode: 'core',
    files: {
      allowRead: ['.'],
      allowWrite: ['.'],
      denyRead: [],
      denyWrite: ['.git/objects'],
    },
    commands: {
      allow: [],
      deny: ['rm -rf /', 'sudo'],
    },
    approval: {
      requiredFor: [],
      requireReason: false,
    },
    checks: {
      required: [],
      rollbackOnFail: false,
    },
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function toRelativePath(filePath: string, workDir: string): string {
  if (filePath.startsWith('/') || filePath.match(/^[A-Za-z]:/)) {
    return relative(resolve(workDir), resolve(filePath));
  }
  return filePath;
}

function pathMatches(relPath: string, pattern: string): boolean {
  // "." matches everything
  if (pattern === '.') return true;
  // Exact prefix match (directory containment)
  if (relPath === pattern) return true;
  if (relPath.startsWith(pattern + '/')) return true;
  // Exact file match (e.g., ".env" matches ".env" or ".env.local")
  if (relPath === pattern || relPath.startsWith(pattern)) return true;
  return false;
}

function commandMatches(command: string, pattern: string): boolean {
  // Check if command starts with or contains the pattern
  return command === pattern || command.startsWith(pattern + ' ') || command.includes(pattern);
}

function makeViolation(
  type: PolicyViolationType,
  target: string,
  rule: string,
): PolicyViolation {
  return {
    type,
    target,
    rule,
    timestamp: new Date().toISOString(),
  };
}
