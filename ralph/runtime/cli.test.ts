import { describe, it, expect, vi } from 'vitest';
import {
  parseArgs,
  resolveCommand,
  replayTaskOps,
  dispatch,
  runMain,
  runDiscover,
  runStatus,
  runSync,
  runLearn,
  loadConfig,
  HELP_TEXT,
  BANNER,
  DEFAULT_CONFIG_PATH,
} from './cli.js';
import type { CliDeps, ParsedArgs } from './cli.js';

// =============================================================================
// HELPERS
// =============================================================================

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    readFile: vi.fn().mockRejectedValue(new Error('not mocked')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    cwd: '/test/ralph',
    log: vi.fn(),
    error: vi.fn(),
    importModule: vi.fn().mockRejectedValue(new Error('not mocked')),
    ...overrides,
  };
}

const MINIMAL_CONFIG = JSON.stringify({
  planFile: './implementation-plan.md',
  agentsFile: './AGENTS.md',
  loop: {
    maxIterationsPerTask: 10,
    maxTasksPerRun: 50,
  },
  sandbox: { timeout: 30000 },
  tracker: { type: 'jira', configPath: './integrations/jira/config.json', autoCreate: false, autoTransition: false, autoComment: false, autoPull: false },
  git: { autoCommit: false },
  learning: { enabled: true },
  notifications: { enabled: false },
});

// =============================================================================
// parseArgs
// =============================================================================

describe('parseArgs', () => {
  it('defaults to run command with no args', () => {
    const result = parseArgs([]);
    expect(result.command).toBe('run');
    expect(result.dryRun).toBe(false);
    expect(result.taskFilter).toBeUndefined();
    expect(result.configPath).toBe(DEFAULT_CONFIG_PATH);
  });

  it('parses run command explicitly', () => {
    const result = parseArgs(['run']);
    expect(result.command).toBe('run');
  });

  it('parses discover command', () => {
    const result = parseArgs(['discover']);
    expect(result.command).toBe('discover');
  });

  it('parses status command', () => {
    const result = parseArgs(['status']);
    expect(result.command).toBe('status');
  });

  it('parses sync command', () => {
    const result = parseArgs(['sync']);
    expect(result.command).toBe('sync');
  });

  it('parses learn command', () => {
    const result = parseArgs(['learn']);
    expect(result.command).toBe('learn');
  });

  it('parses help command', () => {
    const result = parseArgs(['help']);
    expect(result.command).toBe('help');
  });

  it('parses --help flag as help command', () => {
    const result = parseArgs(['--help']);
    expect(result.command).toBe('help');
  });

  it('parses -h flag as help command', () => {
    const result = parseArgs(['-h']);
    expect(result.command).toBe('help');
  });

  it('parses --dry-run flag', () => {
    const result = parseArgs(['run', '--dry-run']);
    expect(result.dryRun).toBe(true);
  });

  it('parses --dry-run without command (defaults to run)', () => {
    const result = parseArgs(['--dry-run']);
    expect(result.command).toBe('run');
    expect(result.dryRun).toBe(true);
  });

  it('parses --task=<id> flag', () => {
    const result = parseArgs(['run', '--task=RALPH-001']);
    expect(result.taskFilter).toBe('RALPH-001');
  });

  it('parses --config=<path> flag', () => {
    const result = parseArgs(['run', '--config=custom.json']);
    expect(result.configPath).toBe('custom.json');
  });

  it('parses multiple flags together', () => {
    const result = parseArgs(['discover', '--dry-run', '--config=my.json', '--task=RALPH-042']);
    expect(result.command).toBe('discover');
    expect(result.dryRun).toBe(true);
    expect(result.configPath).toBe('my.json');
    expect(result.taskFilter).toBe('RALPH-042');
  });

  it('throws on unknown command', () => {
    expect(() => parseArgs(['foobar'])).toThrow('Unknown command: foobar');
  });
});

// =============================================================================
// resolveCommand
// =============================================================================

describe('resolveCommand', () => {
  it('returns run for undefined', () => {
    expect(resolveCommand(undefined)).toBe('run');
  });

  it('returns run for empty string', () => {
    expect(resolveCommand('')).toBe('run');
  });

  it('returns help for --help', () => {
    expect(resolveCommand('--help')).toBe('help');
  });

  it('returns help for -h', () => {
    expect(resolveCommand('-h')).toBe('help');
  });

  it('returns run for flag-like arguments', () => {
    expect(resolveCommand('--dry-run')).toBe('run');
    expect(resolveCommand('--config=foo')).toBe('run');
  });

  it('passes through valid commands', () => {
    expect(resolveCommand('run')).toBe('run');
    expect(resolveCommand('discover')).toBe('discover');
    expect(resolveCommand('sync')).toBe('sync');
    expect(resolveCommand('status')).toBe('status');
    expect(resolveCommand('learn')).toBe('learn');
    expect(resolveCommand('help')).toBe('help');
  });

  it('throws for unknown commands', () => {
    expect(() => resolveCommand('invalid')).toThrow('Unknown command: invalid');
  });
});

// =============================================================================
// replayTaskOps
// =============================================================================

describe('replayTaskOps', () => {
  it('returns empty map for empty lines', () => {
    expect(replayTaskOps([]).size).toBe(0);
  });

  it('creates tasks from create operations', () => {
    const lines = [
      JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'First', status: 'pending', type: 'task' } }),
      JSON.stringify({ op: 'create', task: { id: 'R-002', title: 'Second', status: 'done', type: 'bug' } }),
    ];
    const tasks = replayTaskOps(lines);
    expect(tasks.size).toBe(2);
    expect(tasks.get('R-001')!.title).toBe('First');
    expect(tasks.get('R-002')!.status).toBe('done');
  });

  it('applies update operations', () => {
    const lines = [
      JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'Task', status: 'pending', type: 'task' } }),
      JSON.stringify({ op: 'update', id: 'R-001', changes: { status: 'in_progress' } }),
    ];
    const tasks = replayTaskOps(lines);
    expect(tasks.get('R-001')!.status).toBe('in_progress');
  });

  it('applies title updates', () => {
    const lines = [
      JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'Old', status: 'pending', type: 'task' } }),
      JSON.stringify({ op: 'update', id: 'R-001', changes: { title: 'New' } }),
    ];
    const tasks = replayTaskOps(lines);
    expect(tasks.get('R-001')!.title).toBe('New');
  });

  it('ignores update for non-existent task', () => {
    const lines = [
      JSON.stringify({ op: 'update', id: 'R-999', changes: { status: 'done' } }),
    ];
    const tasks = replayTaskOps(lines);
    expect(tasks.size).toBe(0);
  });

  it('ignores non-create/update operations', () => {
    const lines = [
      JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'Task', status: 'pending', type: 'task' } }),
      JSON.stringify({ op: 'link', id: 'R-001', externalId: 'JIRA-1' }),
    ];
    const tasks = replayTaskOps(lines);
    expect(tasks.size).toBe(1);
    expect(tasks.get('R-001')!.status).toBe('pending');
  });

  it('handles multiple updates to same task', () => {
    const lines = [
      JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'T', status: 'discovered', type: 'task' } }),
      JSON.stringify({ op: 'update', id: 'R-001', changes: { status: 'pending' } }),
      JSON.stringify({ op: 'update', id: 'R-001', changes: { status: 'in_progress' } }),
      JSON.stringify({ op: 'update', id: 'R-001', changes: { status: 'done' } }),
    ];
    const tasks = replayTaskOps(lines);
    expect(tasks.get('R-001')!.status).toBe('done');
  });
});

// =============================================================================
// loadConfig
// =============================================================================

describe('loadConfig', () => {
  it('parses valid JSON config', async () => {
    const mockRead = vi.fn().mockResolvedValue(MINIMAL_CONFIG);
    const config = await loadConfig('/fake/ralph.config.json', mockRead);
    expect(config.planFile).toBe('./implementation-plan.md');
    expect(config.loop.maxTasksPerRun).toBe(50);
    expect(mockRead).toHaveBeenCalledWith('/fake/ralph.config.json', 'utf-8');
  });

  it('throws on missing file', async () => {
    const mockRead = vi.fn().mockRejectedValue(new Error('ENOENT'));
    await expect(loadConfig('/nonexistent/ralph.config.json', mockRead)).rejects.toThrow('ENOENT');
  });

  it('throws on invalid JSON', async () => {
    const mockRead = vi.fn().mockResolvedValue('not json {{{');
    await expect(loadConfig('/fake/bad.json', mockRead)).rejects.toThrow();
  });
});

// =============================================================================
// dispatch — help/sync/learn commands
// =============================================================================

describe('dispatch', () => {
  it('returns 0 for help command', async () => {
    const deps = makeDeps();
    const code = await dispatch(['help'], deps);
    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(HELP_TEXT);
  });

  it('returns 0 for --help flag', async () => {
    const deps = makeDeps();
    const code = await dispatch(['--help'], deps);
    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(HELP_TEXT);
  });

  it('dispatches sync command to runSync', async () => {
    const mockGetTrackerAuth = vi.fn().mockReturnValue(null);
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({ getTrackerAuth: mockGetTrackerAuth }),
    });
    const code = await dispatch(['sync'], deps);
    // Returns 1 because no credentials are set
    expect(code).toBe(1);
    const errMsgs = (deps.error as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(errMsgs).toContain('Missing tracker credentials');
  });

  it('dispatches learn command to runLearn', async () => {
    const deps = makeLearnDeps();
    const code = await dispatch(['learn'], deps);
    expect(code).toBe(0);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('Running learning analysis');
  });
});

// =============================================================================
// runMain
// =============================================================================

describe('runMain', () => {
  it('prints banner and working directory', async () => {
    const mockRunLoop = vi.fn().mockResolvedValue({ tasksCompleted: 1, tasksFailed: 0 });
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({ runLoop: mockRunLoop }),
    });
    const args: ParsedArgs = { command: 'run', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runMain(args, deps);

    // Check banner was printed
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('RALPH');
    expect(logged).toContain('Working directory:');
  });

  it('applies --dry-run to config', async () => {
    const mockRunLoop = vi.fn().mockResolvedValue({ tasksCompleted: 0, tasksFailed: 0 });
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({ runLoop: mockRunLoop }),
    });
    const args: ParsedArgs = { command: 'run', configPath: DEFAULT_CONFIG_PATH, dryRun: true, taskFilter: undefined };

    await runMain(args, deps);

    const config = mockRunLoop.mock.calls[0][0];
    expect(config.loop.dryRun).toBe(true);
  });

  it('applies --task filter to config', async () => {
    const mockRunLoop = vi.fn().mockResolvedValue({ tasksCompleted: 1, tasksFailed: 0 });
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({ runLoop: mockRunLoop }),
    });
    const args: ParsedArgs = { command: 'run', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: 'RALPH-007' };

    await runMain(args, deps);

    const config = mockRunLoop.mock.calls[0][0];
    expect(config.loop.taskFilter).toBe('RALPH-007');
    expect(config.loop.maxTasksPerRun).toBe(1);
  });

  it('returns 0 on success', async () => {
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({
        runLoop: vi.fn().mockResolvedValue({ tasksCompleted: 3, tasksFailed: 0 }),
      }),
    });
    const args: ParsedArgs = { command: 'run', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    expect(await runMain(args, deps)).toBe(0);
  });

  it('returns 1 when all tasks fail', async () => {
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({
        runLoop: vi.fn().mockResolvedValue({ tasksCompleted: 0, tasksFailed: 2 }),
      }),
    });
    const args: ParsedArgs = { command: 'run', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    expect(await runMain(args, deps)).toBe(1);
  });

  it('returns 0 when some tasks succeed and some fail', async () => {
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({
        runLoop: vi.fn().mockResolvedValue({ tasksCompleted: 1, tasksFailed: 1 }),
      }),
    });
    const args: ParsedArgs = { command: 'run', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    expect(await runMain(args, deps)).toBe(0);
  });

  it('logs dry-run mode when enabled', async () => {
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({
        runLoop: vi.fn().mockResolvedValue({ tasksCompleted: 0, tasksFailed: 0 }),
      }),
    });
    const args: ParsedArgs = { command: 'run', configPath: DEFAULT_CONFIG_PATH, dryRun: true, taskFilter: undefined };

    await runMain(args, deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('DRY RUN');
  });

  it('logs task filter when set', async () => {
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({
        runLoop: vi.fn().mockResolvedValue({ tasksCompleted: 0, tasksFailed: 0 }),
      }),
    });
    const args: ParsedArgs = { command: 'run', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: 'RALPH-099' };

    await runMain(args, deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('RALPH-099');
  });
});

// =============================================================================
// runDiscover
// =============================================================================

describe('runDiscover', () => {
  it('calls discoverTasks and printDiscoverySummary', async () => {
    const mockDiscover = vi.fn().mockResolvedValue({ tasks: [], operations: [] });
    const mockPrint = vi.fn();
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({
        discoverTasks: mockDiscover,
        printDiscoverySummary: mockPrint,
      }),
    });
    const args: ParsedArgs = { command: 'discover', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    const code = await runDiscover(args, deps);

    expect(code).toBe(0);
    expect(mockDiscover).toHaveBeenCalledTimes(1);
    expect(mockPrint).toHaveBeenCalledTimes(1);
  });

  it('passes dry-run as undefined writeFile', async () => {
    const mockDiscover = vi.fn().mockResolvedValue({ tasks: [] });
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      writeFile: undefined,
      importModule: vi.fn().mockResolvedValue({
        discoverTasks: mockDiscover,
        printDiscoverySummary: vi.fn(),
      }),
    });
    const args: ParsedArgs = { command: 'discover', configPath: DEFAULT_CONFIG_PATH, dryRun: true, taskFilter: undefined };

    await runDiscover(args, deps);

    const opts = mockDiscover.mock.calls[0][0];
    expect(opts.writeFile).toBeUndefined();
    expect(opts.dryRun).toBe(true);
  });

  it('uses planFile from config', async () => {
    const customConfig = JSON.stringify({
      ...JSON.parse(MINIMAL_CONFIG),
      planFile: './custom-plan.md',
    });
    const mockDiscover = vi.fn().mockResolvedValue({ tasks: [] });
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(customConfig),
      importModule: vi.fn().mockResolvedValue({
        discoverTasks: mockDiscover,
        printDiscoverySummary: vi.fn(),
      }),
    });
    const args: ParsedArgs = { command: 'discover', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runDiscover(args, deps);

    const opts = mockDiscover.mock.calls[0][0];
    expect(opts.planPath).toBe('./custom-plan.md');
  });
});

// =============================================================================
// runStatus
// =============================================================================

describe('runStatus', () => {
  it('displays task counts by status', async () => {
    const taskLines = [
      JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'A', status: 'done', type: 'task' } }),
      JSON.stringify({ op: 'create', task: { id: 'R-002', title: 'B', status: 'done', type: 'task' } }),
      JSON.stringify({ op: 'create', task: { id: 'R-003', title: 'C', status: 'pending', type: 'bug' } }),
    ].join('\n');

    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(taskLines),
    });

    const code = await runStatus(deps);

    expect(code).toBe(0);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('Total tasks: 3');
    expect(logged).toContain('done: 2');
    expect(logged).toContain('pending: 1');
  });

  it('shows in-progress tasks', async () => {
    const taskLines = [
      JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'Working on it', status: 'in_progress', type: 'task' } }),
    ].join('\n');

    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(taskLines),
    });

    await runStatus(deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('In Progress:');
    expect(logged).toContain('R-001: Working on it');
  });

  it('handles missing tasks file gracefully', async () => {
    const deps = makeDeps({
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    });

    const code = await runStatus(deps);

    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith('No tasks found. Run "ralph discover" first.');
  });

  it('replays updates before displaying', async () => {
    const taskLines = [
      JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'T', status: 'pending', type: 'task' } }),
      JSON.stringify({ op: 'update', id: 'R-001', changes: { status: 'done' } }),
    ].join('\n');

    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(taskLines),
    });

    await runStatus(deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('done: 1');
    expect(logged).not.toContain('pending: 1');
  });
});

// =============================================================================
// CONSTANTS
// =============================================================================

describe('constants', () => {
  it('HELP_TEXT contains all commands', () => {
    expect(HELP_TEXT).toContain('run');
    expect(HELP_TEXT).toContain('discover');
    expect(HELP_TEXT).toContain('sync');
    expect(HELP_TEXT).toContain('status');
    expect(HELP_TEXT).toContain('learn');
    expect(HELP_TEXT).toContain('help');
  });

  it('HELP_TEXT contains all options', () => {
    expect(HELP_TEXT).toContain('--config');
    expect(HELP_TEXT).toContain('--dry-run');
    expect(HELP_TEXT).toContain('--task');
  });

  it('BANNER contains Ralph name', () => {
    expect(BANNER).toContain('RALPH');
  });

  it('BANNER contains version', () => {
    expect(BANNER).toContain('v0.1.0');
  });

  it('DEFAULT_CONFIG_PATH is ralph.config.json', () => {
    expect(DEFAULT_CONFIG_PATH).toBe('./ralph.config.json');
  });
});

// =============================================================================
// dispatch — end-to-end integration
// =============================================================================

describe('dispatch integration', () => {
  it('runs main loop via dispatch with no args', async () => {
    const mockRunLoop = vi.fn().mockResolvedValue({ tasksCompleted: 1, tasksFailed: 0 });
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({ runLoop: mockRunLoop }),
    });

    const code = await dispatch([], deps);

    expect(code).toBe(0);
    expect(mockRunLoop).toHaveBeenCalledTimes(1);
  });

  it('runs discover via dispatch', async () => {
    const mockDiscover = vi.fn().mockResolvedValue({ tasks: [] });
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({
        discoverTasks: mockDiscover,
        printDiscoverySummary: vi.fn(),
      }),
    });

    const code = await dispatch(['discover'], deps);

    expect(code).toBe(0);
    expect(mockDiscover).toHaveBeenCalledTimes(1);
  });

  it('runs status via dispatch', async () => {
    const taskLines = JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'T', status: 'done', type: 'task' } });
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(taskLines),
    });

    const code = await dispatch(['status'], deps);

    expect(code).toBe(0);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('Total tasks: 1');
  });

  it('passes --dry-run through dispatch to runMain', async () => {
    const mockRunLoop = vi.fn().mockResolvedValue({ tasksCompleted: 0, tasksFailed: 0 });
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue(MINIMAL_CONFIG),
      importModule: vi.fn().mockResolvedValue({ runLoop: mockRunLoop }),
    });

    await dispatch(['run', '--dry-run', '--task=RALPH-001'], deps);

    const config = mockRunLoop.mock.calls[0][0];
    expect(config.loop.dryRun).toBe(true);
    expect(config.loop.taskFilter).toBe('RALPH-001');
    expect(config.loop.maxTasksPerRun).toBe(1);
  });
});

// =============================================================================
// runSync
// =============================================================================

const TRACKER_CONFIG_JSON = JSON.stringify({
  type: 'jira',
  baseUrl: 'https://example.atlassian.net',
  project: 'RALPH',
  issueTypeMap: { task: 'Task', bug: 'Bug', epic: 'Epic', feature: 'Story', subtask: 'Sub-task' },
  statusMap: { discovered: 'Backlog', pending: 'To Do', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled', blocked: 'Blocked', review: 'In Review' },
  autoCreate: true,
  autoTransition: true,
  autoComment: true,
});

function makeSyncDeps(overrides: {
  getTrackerAuth?: ReturnType<typeof vi.fn>;
  createTracker?: ReturnType<typeof vi.fn>;
  syncBidirectional?: ReturnType<typeof vi.fn>;
  trackerConfigContent?: string;
  adapterImport?: ReturnType<typeof vi.fn>;
} = {}): CliDeps {
  const mockGetTrackerAuth = overrides.getTrackerAuth ?? vi.fn().mockReturnValue({ type: 'token', token: 'tok-123', email: 'test@example.com' });
  const mockCreateTracker = overrides.createTracker ?? vi.fn().mockResolvedValue({ name: 'jira' });
  const mockSyncBidirectional = overrides.syncBidirectional ?? vi.fn().mockResolvedValue({
    push: { processed: 2, created: 1, updated: 0, skipped: 1, errors: [], duration: 500 },
    pull: { processed: 1, created: 0, updated: 1, skipped: 0, errors: [], duration: 300 },
  });

  const readFile = vi.fn().mockImplementation(async (path: string) => {
    if (path.endsWith('ralph.config.json')) return MINIMAL_CONFIG;
    if (path.endsWith('config.json')) return overrides.trackerConfigContent ?? TRACKER_CONFIG_JSON;
    throw new Error(`Unexpected read: ${path}`);
  });

  const importModule = vi.fn().mockImplementation(async (specifier: string) => {
    if (specifier === './loop.js') return { getTrackerAuth: mockGetTrackerAuth };
    if (specifier === '../skills/normalize/index.js') return {
      createTracker: mockCreateTracker,
      syncToTracker: vi.fn(),
      syncFromTracker: vi.fn(),
      syncBidirectional: mockSyncBidirectional,
      printSyncSummary: vi.fn(),
    };
    if (specifier.includes('/adapter.js')) {
      if (overrides.adapterImport) return overrides.adapterImport();
      return {};
    }
    throw new Error(`Unexpected import: ${specifier}`);
  });

  return makeDeps({ readFile, importModule });
}

describe('runSync', () => {
  it('logs sync header', async () => {
    const deps = makeSyncDeps();
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runSync(args, deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('Running tracker sync...');
  });

  it('returns 1 when tracker config file is missing', async () => {
    const readFile = vi.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('ralph.config.json')) return MINIMAL_CONFIG;
      throw new Error('ENOENT');
    });
    const deps = makeDeps({ readFile });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    const code = await runSync(args, deps);

    expect(code).toBe(1);
    const errMsgs = (deps.error as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(errMsgs).toContain('Failed to read tracker config');
  });

  it('returns 1 when credentials are missing', async () => {
    const mockGetTrackerAuth = vi.fn().mockReturnValue(null);
    const deps = makeSyncDeps({ getTrackerAuth: mockGetTrackerAuth });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    const code = await runSync(args, deps);

    expect(code).toBe(1);
    const errMsgs = (deps.error as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(errMsgs).toContain('Missing tracker credentials');
    expect(errMsgs).toContain('RALPH_JIRA_TOKEN');
  });

  it('returns 1 when tracker creation fails', async () => {
    const mockCreateTracker = vi.fn().mockRejectedValue(new Error('No factory registered'));
    const deps = makeSyncDeps({ createTracker: mockCreateTracker });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    const code = await runSync(args, deps);

    expect(code).toBe(1);
    const errMsgs = (deps.error as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(errMsgs).toContain('Failed to create tracker');
  });

  it('performs bidirectional sync and returns 0 on success', async () => {
    const mockSyncBidirectional = vi.fn().mockResolvedValue({
      push: { processed: 3, created: 2, updated: 0, skipped: 1, errors: [], duration: 800 },
      pull: { processed: 1, created: 0, updated: 1, skipped: 0, errors: [], duration: 200 },
    });
    const deps = makeSyncDeps({ syncBidirectional: mockSyncBidirectional });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    const code = await runSync(args, deps);

    expect(code).toBe(0);
    expect(mockSyncBidirectional).toHaveBeenCalledTimes(1);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('PULL');
    expect(logged).toContain('PUSH');
    expect(logged).toContain('Sync complete');
  });

  it('returns 1 when sync has errors', async () => {
    const mockSyncBidirectional = vi.fn().mockResolvedValue({
      push: { processed: 1, created: 0, updated: 0, skipped: 0, errors: [{ taskId: 'R-001', error: 'API error' }], duration: 100 },
      pull: { processed: 0, created: 0, updated: 0, skipped: 0, errors: [], duration: 50 },
    });
    const deps = makeSyncDeps({ syncBidirectional: mockSyncBidirectional });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    const code = await runSync(args, deps);

    expect(code).toBe(1);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('1 error(s)');
  });

  it('displays sync errors in output', async () => {
    const mockSyncBidirectional = vi.fn().mockResolvedValue({
      push: { processed: 1, created: 0, updated: 0, skipped: 0, errors: [{ taskId: 'R-001', error: 'Connection refused' }], duration: 100 },
      pull: { processed: 0, created: 0, updated: 0, skipped: 0, errors: [], duration: 50 },
    });
    const deps = makeSyncDeps({ syncBidirectional: mockSyncBidirectional });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runSync(args, deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('R-001');
    expect(logged).toContain('Connection refused');
  });

  it('passes --task filter as taskIds option', async () => {
    const mockSyncBidirectional = vi.fn().mockResolvedValue({
      push: { processed: 1, created: 1, updated: 0, skipped: 0, errors: [], duration: 100 },
      pull: { processed: 0, created: 0, updated: 0, skipped: 0, errors: [], duration: 50 },
    });
    const deps = makeSyncDeps({ syncBidirectional: mockSyncBidirectional });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: 'RALPH-042' };

    await runSync(args, deps);

    const opts = mockSyncBidirectional.mock.calls[0][1];
    expect(opts.taskIds).toEqual(['RALPH-042']);
  });

  it('passes --dry-run option to sync', async () => {
    const mockSyncBidirectional = vi.fn().mockResolvedValue({
      push: { processed: 0, created: 0, updated: 0, skipped: 0, errors: [], duration: 0 },
      pull: { processed: 0, created: 0, updated: 0, skipped: 0, errors: [], duration: 0 },
    });
    const deps = makeSyncDeps({ syncBidirectional: mockSyncBidirectional });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: true, taskFilter: undefined };

    await runSync(args, deps);

    const opts = mockSyncBidirectional.mock.calls[0][1];
    expect(opts.dryRun).toBe(true);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('DRY RUN');
  });

  it('resolves tracker auth via getTrackerAuth', async () => {
    const mockGetTrackerAuth = vi.fn().mockReturnValue({ type: 'token', token: 'my-token' });
    const deps = makeSyncDeps({ getTrackerAuth: mockGetTrackerAuth });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runSync(args, deps);

    expect(mockGetTrackerAuth).toHaveBeenCalledWith('jira');
  });

  it('creates tracker with parsed config and auth', async () => {
    const mockCreateTracker = vi.fn().mockResolvedValue({ name: 'jira' });
    const deps = makeSyncDeps({ createTracker: mockCreateTracker });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runSync(args, deps);

    expect(mockCreateTracker).toHaveBeenCalledTimes(1);
    const [config, auth] = mockCreateTracker.mock.calls[0];
    expect(config.type).toBe('jira');
    expect(auth.token).toBe('tok-123');
  });

  it('returns 1 when syncBidirectional throws', async () => {
    const mockSyncBidirectional = vi.fn().mockRejectedValue(new Error('Network timeout'));
    const deps = makeSyncDeps({ syncBidirectional: mockSyncBidirectional });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    const code = await runSync(args, deps);

    expect(code).toBe(1);
    const errMsgs = (deps.error as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(errMsgs).toContain('Sync failed');
    expect(errMsgs).toContain('Network timeout');
  });

  it('gracefully handles adapter import failure', async () => {
    const adapterImport = vi.fn().mockRejectedValue(new Error('Module not found'));
    const deps = makeSyncDeps({ adapterImport });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    // Should not throw — adapter import is caught
    const code = await runSync(args, deps);

    expect(code).toBe(0);
  });

  it('prints pull and push summary with durations', async () => {
    const mockSyncBidirectional = vi.fn().mockResolvedValue({
      push: { processed: 5, created: 3, updated: 1, skipped: 1, errors: [], duration: 1234 },
      pull: { processed: 2, created: 0, updated: 2, skipped: 0, errors: [], duration: 567 },
    });
    const deps = makeSyncDeps({ syncBidirectional: mockSyncBidirectional });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runSync(args, deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('Processed: 5');
    expect(logged).toContain('Created:   3');
    expect(logged).toContain('Updated:   2');
    expect(logged).toContain('1.2s');
    expect(logged).toContain('0.6s');
  });

  it('combines --task and --dry-run options', async () => {
    const mockSyncBidirectional = vi.fn().mockResolvedValue({
      push: { processed: 1, created: 0, updated: 0, skipped: 1, errors: [], duration: 50 },
      pull: { processed: 0, created: 0, updated: 0, skipped: 0, errors: [], duration: 20 },
    });
    const deps = makeSyncDeps({ syncBidirectional: mockSyncBidirectional });
    const args: ParsedArgs = { command: 'sync', configPath: DEFAULT_CONFIG_PATH, dryRun: true, taskFilter: 'RALPH-007' };

    const code = await runSync(args, deps);

    expect(code).toBe(0);
    const opts = mockSyncBidirectional.mock.calls[0][1];
    expect(opts.taskIds).toEqual(['RALPH-007']);
    expect(opts.dryRun).toBe(true);
  });

  it('works via dispatch', async () => {
    const mockSyncBidirectional = vi.fn().mockResolvedValue({
      push: { processed: 0, created: 0, updated: 0, skipped: 0, errors: [], duration: 0 },
      pull: { processed: 0, created: 0, updated: 0, skipped: 0, errors: [], duration: 0 },
    });
    const mockGetTrackerAuth = vi.fn().mockReturnValue({ type: 'token', token: 'tok-123' });
    const mockCreateTracker = vi.fn().mockResolvedValue({ name: 'jira' });

    const readFile = vi.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('ralph.config.json')) return MINIMAL_CONFIG;
      if (path.endsWith('config.json')) return TRACKER_CONFIG_JSON;
      throw new Error(`Unexpected: ${path}`);
    });

    const importModule = vi.fn().mockImplementation(async (specifier: string) => {
      if (specifier === './loop.js') return { getTrackerAuth: mockGetTrackerAuth };
      if (specifier === '../skills/normalize/index.js') return {
        createTracker: mockCreateTracker,
        syncBidirectional: mockSyncBidirectional,
      };
      if (specifier.includes('/adapter.js')) return {};
      throw new Error(`Unexpected import: ${specifier}`);
    });

    const deps = makeDeps({ readFile, importModule });
    const code = await dispatch(['sync'], deps);

    expect(code).toBe(0);
    expect(mockSyncBidirectional).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// runLearn
// =============================================================================

const TASK_OPS_WITH_COMPLETED = [
  JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'Task A', status: 'done', type: 'task', aggregate: 'runtime', domain: 'core' } }),
  JSON.stringify({ op: 'create', task: { id: 'R-002', title: 'Task B', status: 'done', type: 'bug', aggregate: 'runtime', domain: 'core' } }),
  JSON.stringify({ op: 'create', task: { id: 'R-003', title: 'Task C', status: 'done', type: 'task', aggregate: 'skills', domain: 'discovery' } }),
  JSON.stringify({ op: 'create', task: { id: 'R-004', title: 'Task D', status: 'pending', type: 'task', aggregate: 'runtime', domain: 'core' } }),
].join('\n');

const TASK_OPS_NO_COMPLETED = [
  JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'Pending', status: 'pending', type: 'task' } }),
  JSON.stringify({ op: 'create', task: { id: 'R-002', title: 'In Progress', status: 'in_progress', type: 'task' } }),
].join('\n');

const LEARNING_CONFIG_DISABLED = JSON.stringify({
  ...JSON.parse(MINIMAL_CONFIG),
  learning: { enabled: false, autoApplyImprovements: false, minConfidence: 0.7, retentionDays: 90 },
});

const LEARNING_CONFIG_CUSTOM = JSON.stringify({
  ...JSON.parse(MINIMAL_CONFIG),
  learning: { enabled: true, autoApplyImprovements: false, minConfidence: 0.9, retentionDays: 90 },
});

function makeLearnDeps(overrides: {
  taskOps?: string;
  configJson?: string;
  detectPatterns?: ReturnType<typeof vi.fn>;
  generateImprovements?: ReturnType<typeof vi.fn>;
  loadPendingProposals?: ReturnType<typeof vi.fn>;
  recordTaskMetrics?: ReturnType<typeof vi.fn>;
  computeAggregateMetrics?: ReturnType<typeof vi.fn>;
  saveProposals?: ReturnType<typeof vi.fn>;
  learningContent?: string;
} = {}): CliDeps {
  const taskContent = overrides.taskOps ?? TASK_OPS_WITH_COMPLETED;
  const configContent = overrides.configJson ?? MINIMAL_CONFIG;
  const learningContent = overrides.learningContent ?? '';

  const mockRecordTaskMetrics = overrides.recordTaskMetrics ?? vi.fn().mockImplementation((task: { id: string }) => ({
    taskId: task.id, type: 'task', iterations: 3, filesChanged: 5, linesChanged: 100,
  }));
  const mockComputeAggregateMetrics = overrides.computeAggregateMetrics ?? vi.fn().mockReturnValue({
    period: '2026-02', tasksCompleted: 3, avgIterations: 3, avgDurationDays: 1,
    byType: {}, byComplexity: {},
  });
  const mockDetectPatterns = overrides.detectPatterns ?? vi.fn().mockReturnValue({
    patterns: [],
    summary: { total: 0, byType: {} },
  });
  const mockGenerateImprovements = overrides.generateImprovements ?? vi.fn().mockReturnValue({
    proposals: [],
    summary: { total: 0, byTarget: {} },
  });
  const mockLoadPendingProposals = overrides.loadPendingProposals ?? vi.fn().mockResolvedValue([]);
  const mockSaveProposals = overrides.saveProposals ?? vi.fn().mockResolvedValue(undefined);

  const readFile = vi.fn().mockImplementation(async (path: string) => {
    if (path.endsWith('ralph.config.json')) return configContent;
    if (path.endsWith('tasks.jsonl')) return taskContent;
    if (path.endsWith('learning.jsonl')) return learningContent;
    throw new Error(`Unexpected read: ${path}`);
  });

  const importModule = vi.fn().mockImplementation(async (specifier: string) => {
    if (specifier === '../skills/track/record-metrics.js') return {
      recordTaskMetrics: mockRecordTaskMetrics,
      computeAggregateMetrics: mockComputeAggregateMetrics,
      getCurrentPeriod: vi.fn().mockReturnValue('2026-02'),
      printMetricsSummary: vi.fn(),
    };
    if (specifier === '../skills/discovery/detect-patterns.js') return {
      detectPatterns: mockDetectPatterns,
      printPatterns: vi.fn(),
    };
    if (specifier === '../skills/discovery/improve-agents.js') return {
      generateImprovements: mockGenerateImprovements,
      saveProposals: mockSaveProposals,
      loadPendingProposals: mockLoadPendingProposals,
      printProposals: vi.fn(),
    };
    throw new Error(`Unexpected import: ${specifier}`);
  });

  return makeDeps({ readFile, importModule });
}

describe('runLearn', () => {
  it('logs analysis header', async () => {
    const deps = makeLearnDeps();
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('Running learning analysis');
  });

  it('returns 0 when learning is disabled', async () => {
    const deps = makeLearnDeps({ configJson: LEARNING_CONFIG_DISABLED });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    const code = await runLearn(args, deps);

    expect(code).toBe(0);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('Learning is disabled');
  });

  it('returns 0 when no completed tasks exist', async () => {
    const deps = makeLearnDeps({ taskOps: TASK_OPS_NO_COMPLETED });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    const code = await runLearn(args, deps);

    expect(code).toBe(0);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('No completed tasks');
  });

  it('returns 0 when tasks file is missing', async () => {
    const readFile = vi.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('ralph.config.json')) return MINIMAL_CONFIG;
      if (path.endsWith('tasks.jsonl')) throw new Error('ENOENT');
      if (path.endsWith('learning.jsonl')) return '';
      throw new Error(`Unexpected: ${path}`);
    });
    const deps = makeLearnDeps();
    (deps as { readFile: ReturnType<typeof vi.fn> }).readFile = readFile;

    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };
    const code = await runLearn(args, deps);

    expect(code).toBe(0);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('No completed tasks');
  });

  it('calls recordTaskMetrics for each completed task', async () => {
    const mockRecordTaskMetrics = vi.fn().mockReturnValue({ taskId: 'x', type: 'task' });
    const deps = makeLearnDeps({ recordTaskMetrics: mockRecordTaskMetrics });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    // 3 completed tasks (R-001, R-002, R-003), R-004 is pending
    expect(mockRecordTaskMetrics).toHaveBeenCalledTimes(3);
  });

  it('calls detectPatterns with correct context', async () => {
    const mockDetectPatterns = vi.fn().mockReturnValue({ patterns: [], summary: { total: 0, byType: {} } });
    const deps = makeLearnDeps({ detectPatterns: mockDetectPatterns });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    expect(mockDetectPatterns).toHaveBeenCalledTimes(1);
    const ctx = mockDetectPatterns.mock.calls[0][0];
    expect(ctx.minConfidence).toBe(0.7);
    expect(ctx.minSamples).toBe(3);
    expect(ctx.metrics).toHaveLength(3);
    expect(ctx.aggregates).toHaveLength(1);
    expect(ctx.tasks).toBeInstanceOf(Map);
  });

  it('uses minConfidence from config', async () => {
    const mockDetectPatterns = vi.fn().mockReturnValue({ patterns: [], summary: { total: 0, byType: {} } });
    const deps = makeLearnDeps({ configJson: LEARNING_CONFIG_CUSTOM, detectPatterns: mockDetectPatterns });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    const ctx = mockDetectPatterns.mock.calls[0][0];
    expect(ctx.minConfidence).toBe(0.9);
  });

  it('calls generateImprovements with patterns and aggregate', async () => {
    const mockPattern = { type: 'estimation_drift', confidence: 0.8, data: {} };
    const mockDetectPatterns = vi.fn().mockReturnValue({ patterns: [mockPattern], summary: { total: 1, byType: {} } });
    const mockGenerateImprovements = vi.fn().mockReturnValue({ proposals: [], summary: { total: 0, byTarget: {} } });
    const deps = makeLearnDeps({ detectPatterns: mockDetectPatterns, generateImprovements: mockGenerateImprovements });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    expect(mockGenerateImprovements).toHaveBeenCalledTimes(1);
    const [patterns, aggregate] = mockGenerateImprovements.mock.calls[0];
    expect(patterns).toEqual([mockPattern]);
    expect(aggregate).toBeDefined();
  });

  it('saves proposals when not dry-run', async () => {
    const mockProposal = { id: 'P-001', title: 'Improve estimates', target: 'AGENTS.md', status: 'pending' };
    const mockGenerateImprovements = vi.fn().mockReturnValue({
      proposals: [mockProposal],
      summary: { total: 1, byTarget: {} },
    });
    const mockSaveProposals = vi.fn().mockResolvedValue(undefined);
    const deps = makeLearnDeps({ generateImprovements: mockGenerateImprovements, saveProposals: mockSaveProposals });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    expect(mockSaveProposals).toHaveBeenCalledTimes(1);
    const [, , path, proposals] = mockSaveProposals.mock.calls[0];
    expect(path).toBe('./state/learning.jsonl');
    expect(proposals).toEqual([mockProposal]);
  });

  it('does not save proposals in dry-run mode', async () => {
    const mockProposal = { id: 'P-001', title: 'Improve estimates', target: 'AGENTS.md', status: 'pending' };
    const mockGenerateImprovements = vi.fn().mockReturnValue({
      proposals: [mockProposal],
      summary: { total: 1, byTarget: {} },
    });
    const mockSaveProposals = vi.fn().mockResolvedValue(undefined);
    const deps = makeLearnDeps({ generateImprovements: mockGenerateImprovements, saveProposals: mockSaveProposals });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: true, taskFilter: undefined };

    await runLearn(args, deps);

    expect(mockSaveProposals).not.toHaveBeenCalled();
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('DRY RUN');
  });

  it('displays pending proposals', async () => {
    const mockLoadPendingProposals = vi.fn().mockResolvedValue([
      { id: 'P-001', title: 'Fix estimates', target: 'AGENTS.md', section: 'Estimation', priority: 'high', confidence: 0.85, description: 'Add multiplier' },
      { id: 'P-002', title: 'Add tests', target: 'agents/learner.md', priority: 'medium', confidence: 0.72, description: 'Improve coverage' },
    ]);
    const deps = makeLearnDeps({ loadPendingProposals: mockLoadPendingProposals });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('Pending proposals: 2');
    expect(logged).toContain('P-001');
    expect(logged).toContain('Fix estimates');
    expect(logged).toContain('AGENTS.md');
    expect(logged).toContain('Estimation');
    expect(logged).toContain('85%');
    expect(logged).toContain('P-002');
    expect(logged).toContain('Add tests');
  });

  it('prints learning summary', async () => {
    const mockDetectPatterns = vi.fn().mockReturnValue({
      patterns: [{ type: 'bug_hotspot' }, { type: 'estimation_drift' }],
      summary: { total: 2, byType: {} },
    });
    const mockGenerateImprovements = vi.fn().mockReturnValue({
      proposals: [{ id: 'P-001' }],
      summary: { total: 1, byTarget: {} },
    });
    const deps = makeLearnDeps({ detectPatterns: mockDetectPatterns, generateImprovements: mockGenerateImprovements });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('LEARNING SUMMARY');
    expect(logged).toContain('Tasks analyzed:    3');
    expect(logged).toContain('Patterns detected: 2');
    expect(logged).toContain('Proposals created: 1');
  });

  it('replays update operations before analysis', async () => {
    const taskOps = [
      JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'T', status: 'pending', type: 'task' } }),
      JSON.stringify({ op: 'update', id: 'R-001', changes: { status: 'done' } }),
    ].join('\n');
    const mockRecordTaskMetrics = vi.fn().mockReturnValue({ taskId: 'R-001', type: 'task' });
    const deps = makeLearnDeps({ taskOps, recordTaskMetrics: mockRecordTaskMetrics });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    expect(mockRecordTaskMetrics).toHaveBeenCalledTimes(1);
    const task = mockRecordTaskMetrics.mock.calls[0][0];
    expect(task.status).toBe('done');
  });

  it('replays link operations before analysis', async () => {
    const taskOps = [
      JSON.stringify({ op: 'create', task: { id: 'R-001', title: 'T', status: 'done', type: 'task' } }),
      JSON.stringify({ op: 'link', id: 'R-001', externalId: 'JIRA-42', externalUrl: 'https://jira.example.com/JIRA-42' }),
    ].join('\n');
    const mockDetectPatterns = vi.fn().mockReturnValue({ patterns: [], summary: { total: 0, byType: {} } });
    const deps = makeLearnDeps({ taskOps, detectPatterns: mockDetectPatterns });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    const ctx = mockDetectPatterns.mock.calls[0][0];
    const task = ctx.tasks.get('R-001');
    expect(task.externalId).toBe('JIRA-42');
  });

  it('does not save proposals when none generated', async () => {
    const mockSaveProposals = vi.fn().mockResolvedValue(undefined);
    const deps = makeLearnDeps({ saveProposals: mockSaveProposals });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    expect(mockSaveProposals).not.toHaveBeenCalled();
  });

  it('logs saved proposal count', async () => {
    const mockGenerateImprovements = vi.fn().mockReturnValue({
      proposals: [{ id: 'P-001' }, { id: 'P-002' }],
      summary: { total: 2, byTarget: {} },
    });
    const deps = makeLearnDeps({ generateImprovements: mockGenerateImprovements });
    const args: ParsedArgs = { command: 'learn', configPath: DEFAULT_CONFIG_PATH, dryRun: false, taskFilter: undefined };

    await runLearn(args, deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('Saved 2 proposal(s)');
    expect(logged).toContain('learning.jsonl');
  });

  it('works via dispatch with flags', async () => {
    const deps = makeLearnDeps();
    const code = await dispatch(['learn', '--dry-run'], deps);

    expect(code).toBe(0);
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('DRY RUN');
  });
});
