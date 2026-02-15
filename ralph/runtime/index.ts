/**
 * Ralph - Agentic Delivery OS
 *
 * Runtime library entry point.
 * For CLI usage, see cli.ts (the bin entry point).
 */

import { readFile, writeFile } from 'fs/promises';
import { dispatch } from './cli.js';

// Export modules for programmatic use
export { runLoop, type LoopContext, type LoopResult, type RunKpiInput, type RunKpis, type InductionInvariantReport, pickNextTask, executeTaskLoop, executeIteration, updateTaskStatus, recordTaskCompletion, runLearningAnalysis, autoApplyImprovements, runGitWatcher, syncTaskToTracker, pullFromTracker, getTrackerAuth, estimateCost, computeRunKpis, validateInductionInvariant, invokeHook, validateAndAppendTaskOp, readJsonl, appendJsonl, runPolicyChecksBeforeCommit } from './loop.js';
export { createExecutor, Executor, GitOperations } from './executor.js';
export { createSandbox, Sandbox, printSandboxStatus, type FileChange } from './sandbox.js';
export { executeLLMIteration, executeToolCall, buildSystemPrompt, buildIterationPrompt, interpretResponse, loadTaskContext, createLLMProvider, createDefaultLLMProvider, AGENT_TOOLS } from './llm.js';
export { AnthropicProvider, OpenAIProvider, createProvider, resolveApiKey, formatAnthropicMessages, formatAnthropicTools, parseAnthropicResponse, mapAnthropicStopReason, formatOpenAIMessages, formatOpenAITools, parseOpenAIResponse, mapOpenAIFinishReason } from './llm-providers.js';
export { parseArgs, resolveCommand, loadConfig, dispatch, runMain, runDiscover, runStatus, runDashboard, runReview, runApprove, runReject, buildDashboardData, formatDashboard, replayTaskOps, HELP_TEXT, BANNER, DEFAULT_CONFIG_PATH, type ParsedArgs, type CliCommand, type CliDeps, type DashboardData } from './cli.js';
export { checkCompletion, checkCriteria, checkTestPassing, checkFileExists, checkValidate, createCompletionContext, type CompletionCheckResult, type CompletionContext } from './completion.js';
export { formatNotification, sendConsole, sendSlack, sendEmail, shouldNotify, dispatchNotification, notifyAnomaly, notifyTaskComplete, notifyLimitReached, resolveNotificationEnv, type NotificationEvent, type NotificationPayload, type NotificationDeps } from './notifications.js';
export { loadPolicy, validatePolicy, checkFileRead, checkFileWrite, checkCommand, classifyAction, requiresApproval, runRequiredChecks, allChecksPassed, createViolationEvent, enforceFileRead, enforceFileWrite, enforceCommand, defaultPolicy, type CheckRunner, type CheckResult } from './policy.js';
export { resolveStatePaths, legacyStatePaths, slugifyRepoName, type StatePaths } from './state-paths.js';

// When executed directly (tsx runtime/index.ts), run the CLI
const scriptPath = process.argv[1]?.replace(/\\/g, '/');
const isDirectExecution = scriptPath?.endsWith('runtime/index.ts')
  || scriptPath?.endsWith('runtime/index.js');

if (isDirectExecution) {
  dispatch(process.argv.slice(2), {
    readFile: (path: string, encoding: 'utf-8') => readFile(path, encoding),
    writeFile: (path: string, content: string) => writeFile(path, content),
    cwd: process.cwd(),
    log: (msg: string) => console.log(msg),
    error: (msg: string) => console.error(msg),
    importModule: (specifier: string) => import(specifier),
  }).then(code => {
    if (code !== 0) process.exit(code);
  }).catch(err => {
    console.error('Ralph failed:', err);
    process.exit(1);
  });
}
