import { describe, it, expect, vi } from 'vitest';
import {
  detectBootstrapInputs,
  buildBootstrapArtifacts,
  buildImplementationPlan,
} from './bootstrap.js';

describe('detectBootstrapInputs', () => {
  it('prefers commands from ralph.config.json', async () => {
    const readFile = vi.fn(async (path: string) => {
      if (path.endsWith('package.json')) {
        return JSON.stringify({
          name: 'target-repo',
          scripts: { test: 'npm run test:unit', build: 'npm run compile' },
        });
      }
      if (path.endsWith('ralph.config.json')) {
        return JSON.stringify({
          commands: { test: 'pnpm test', build: 'pnpm build' },
        });
      }
      if (path.endsWith('ralph.policy.json')) {
        return JSON.stringify({ checks: { required: ['test', 'lint'] } });
      }
      throw new Error('missing');
    });

    const result = await detectBootstrapInputs('/repo', readFile);
    expect(result.projectName).toBe('target-repo');
    expect(result.testCommand).toBe('pnpm test');
    expect(result.buildCommand).toBe('pnpm build');
    expect(result.requiredChecks).toEqual(['test', 'lint']);
  });

  it('falls back to package.json scripts when config is missing', async () => {
    const readFile = vi.fn(async (path: string) => {
      if (path.endsWith('package.json')) {
        return JSON.stringify({
          name: 'pkg-name',
          scripts: { test: 'npm test -- --runInBand', build: 'npm run build:prod' },
        });
      }
      throw new Error('missing');
    });

    const result = await detectBootstrapInputs('/repo', readFile);
    expect(result.projectName).toBe('pkg-name');
    expect(result.testCommand).toBe('npm test -- --runInBand');
    expect(result.buildCommand).toBe('npm run build:prod');
    expect(result.requiredChecks).toEqual(['test', 'build']);
  });

  it('falls back to defaults when config and package are missing', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    const result = await detectBootstrapInputs('/repo-name', readFile);
    expect(result.projectName).toBe('repo-name');
    expect(result.testCommand).toBe('npm test');
    expect(result.buildCommand).toBe('npm run build');
    expect(result.requiredChecks).toEqual(['test', 'build']);
  });
});

describe('buildBootstrapArtifacts', () => {
  it('generates all required spec files and implementation plan', () => {
    const artifacts = buildBootstrapArtifacts({
      projectName: 'demo',
      testCommand: 'npm test',
      buildCommand: 'npm run build',
      requiredChecks: ['test', 'build'],
    }, new Date('2026-02-15T00:00:00.000Z'));

    expect(Object.keys(artifacts).sort()).toEqual([
      'implementation-plan.md',
      'specs/architecture.md',
      'specs/delivery-workflow.md',
      'specs/quality-gates.md',
      'specs/system-context.md',
    ]);
  });

  it('includes explicit spec citations in generated implementation plan', () => {
    const plan = buildImplementationPlan({
      projectName: 'demo',
      testCommand: 'npm test',
      buildCommand: 'npm run build',
      requiredChecks: ['test', 'build'],
    }, '2026-02-15T00:00:00.000Z');

    expect(plan).toContain('[specs/system-context.md](./specs/system-context.md)');
    expect(plan).toContain('[specs/architecture.md](./specs/architecture.md)');
    expect(plan).toContain('[specs/delivery-workflow.md](./specs/delivery-workflow.md)');
    expect(plan).toContain('[specs/quality-gates.md](./specs/quality-gates.md)');
    expect(plan).toContain('`npm test`');
    expect(plan).toContain('`npm run build`');
  });
});
