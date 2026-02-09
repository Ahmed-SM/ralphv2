# Runtime Index

> The runtime is where Ralph executes. It integrates just-bash and runs the loop.

## Components

| Component | File | Purpose |
|-----------|------|---------|
| Executor | executor.ts | Wraps just-bash for sandboxed execution |
| Loop | loop.ts | Main Ralph loop implementation |
| Sandbox | sandbox.ts | Sandbox configuration and management |
| Config | config.ts | Runtime configuration |

## Just-Bash Integration

Ralph uses [just-bash](https://github.com/vercel-labs/just-bash) for sandboxed execution:

```typescript
import { createSandbox } from 'just-bash';

const sandbox = await createSandbox({
  // OverlayFS for isolated filesystem
  filesystem: {
    base: process.cwd(),
    overlay: true
  },

  // Sandboxed bash
  bash: {
    enabled: true,
    timeout: 30000
  },

  // TypeScript interpreter
  typescript: {
    enabled: true
  }
});
```

## Executor

```typescript
// runtime/executor.ts

export class Executor {
  private sandbox: Sandbox;

  async bash(command: string): Promise<BashResult> {
    return this.sandbox.bash(command);
  }

  async eval(code: string): Promise<any> {
    return this.sandbox.eval(code);
  }

  async readFile(path: string): Promise<string> {
    return this.sandbox.fs.readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sandbox.fs.writeFile(path, content);
  }

  // Commit escapes sandbox to real git
  async commit(message: string): Promise<void> {
    await this.sandbox.flush();  // Apply overlay changes
    await git.add('.');
    await git.commit(message);
  }
}
```

## Loop Runner

```typescript
// runtime/loop.ts

export async function runLoop(config: LoopConfig): Promise<void> {
  const executor = new Executor(config);

  while (true) {
    // 1. Read index
    const agents = await executor.readFile('./AGENTS.md');
    const plan = await executor.readFile('./implementation-plan.md');

    // 2. Pick task
    const task = await pickNextTask('./state/tasks.jsonl');
    if (!task) break;

    // 3. Execute task loop
    let iteration = 0;
    while (iteration < config.maxIterations) {
      const result = await executeIteration(task, executor);

      if (result.status === 'complete') {
        await markComplete(task);
        break;
      }

      if (result.status === 'blocked') {
        await markBlocked(task, result.blocker);
        break;
      }

      iteration++;
    }

    // 4. Commit
    await executor.commit(`RALPH-${task.id}: ${task.title}`);

    // 5. Sync tracker
    await syncToTracker(task);

    // 6. Learn
    await recordMetrics(task, iteration);
  }
}
```

## Configuration

```typescript
// runtime/config.ts

export interface RuntimeConfig {
  // Loop limits
  maxIterationsPerTask: number;
  maxTimePerTask: number;  // ms
  maxCostPerTask: number;  // $
  maxTasksPerRun: number;
  maxTimePerRun: number;

  // Behavior
  onFailure: 'stop' | 'continue' | 'retry';
  parallelism: number;

  // Sandbox
  sandbox: {
    timeout: number;
    memory: number;  // MB
  };

  // Tracker
  tracker: {
    type: string;
    autoSync: boolean;
  };

  // Learning
  learning: {
    enabled: boolean;
    autoApply: boolean;
  };
}

export const defaultConfig: RuntimeConfig = {
  maxIterationsPerTask: 10,
  maxTimePerTask: 1800000,  // 30 min
  maxCostPerTask: 5,
  maxTasksPerRun: 50,
  maxTimePerRun: 14400000,  // 4 hours

  onFailure: 'continue',
  parallelism: 1,

  sandbox: {
    timeout: 30000,
    memory: 512
  },

  tracker: {
    type: 'jira',
    autoSync: true
  },

  learning: {
    enabled: true,
    autoApply: false
  }
};
```

## Entry Point

```typescript
// runtime/index.ts

import { runLoop } from './loop';
import { loadConfig } from './config';

async function main() {
  const config = await loadConfig('./ralph.config.json');

  console.log('Ralph starting...');
  console.log(`Reading: ${config.planFile}`);

  await runLoop(config);

  console.log('Ralph complete.');
}

main().catch(console.error);
```

## CLI (Planned)

```bash
# Run full loop
ralph run

# Run single task
ralph run --task RALPH-001

# Dry run (no commits)
ralph run --dry-run

# Discover tasks only
ralph discover

# Sync to tracker only
ralph sync

# Show status
ralph status
```

---

*Referenced by: [../AGENTS.md](../AGENTS.md)*
*Uses: [just-bash](https://github.com/vercel-labs/just-bash)*
