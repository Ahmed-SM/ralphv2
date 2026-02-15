import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatNotification,
  sendConsole,
  sendSlack,
  sendEmail,
  shouldNotify,
  dispatchNotification,
  notifyAnomaly,
  notifyTaskComplete,
  notifyLimitReached,
  resolveNotificationEnv,
  type NotificationEvent,
  type NotificationPayload,
  type NotificationDeps,
} from './notifications.js';
import type {
  NotificationConfig,
  Task,
  AnomalyDetectedEvent,
} from '../types/index.js';

// =============================================================================
// HELPERS
// =============================================================================

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: 'A test task',
    status: 'done',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAnomaly(overrides: Partial<AnomalyDetectedEvent> = {}): AnomalyDetectedEvent {
  return {
    type: 'anomaly_detected',
    anomaly: 'Task RALPH-042 took 12 iterations (expected 3)',
    severity: 'high',
    context: { pattern: 'iteration_anomaly' },
    timestamp: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return {
    onAnomaly: true,
    onComplete: false,
    channel: 'console',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<NotificationDeps> = {}): NotificationDeps {
  return {
    fetch: vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' }),
    log: vi.fn(),
    ...overrides,
  };
}

// =============================================================================
// formatNotification
// =============================================================================

describe('formatNotification', () => {
  it('formats anomaly with high severity as critical', () => {
    const event: NotificationEvent = { type: 'anomaly', anomaly: makeAnomaly({ severity: 'high' }) };
    const payload = formatNotification(event);
    expect(payload.severity).toBe('critical');
    expect(payload.title).toContain('Anomaly Detected');
    expect(payload.title).toContain('high');
    expect(payload.body).toBe('Task RALPH-042 took 12 iterations (expected 3)');
  });

  it('formats anomaly with medium severity as warning', () => {
    const event: NotificationEvent = { type: 'anomaly', anomaly: makeAnomaly({ severity: 'medium' }) };
    const payload = formatNotification(event);
    expect(payload.severity).toBe('warning');
  });

  it('formats anomaly with low severity as info', () => {
    const event: NotificationEvent = { type: 'anomaly', anomaly: makeAnomaly({ severity: 'low' }) };
    const payload = formatNotification(event);
    expect(payload.severity).toBe('info');
  });

  it('formats successful task completion', () => {
    const event: NotificationEvent = { type: 'task_complete', task: makeTask(), success: true };
    const payload = formatNotification(event);
    expect(payload.title).toContain('Task Completed');
    expect(payload.title).toContain('RALPH-001');
    expect(payload.body).toBe('Test task');
    expect(payload.severity).toBe('info');
  });

  it('formats failed task completion', () => {
    const event: NotificationEvent = { type: 'task_complete', task: makeTask({ status: 'blocked' }), success: false };
    const payload = formatNotification(event);
    expect(payload.title).toContain('Task Failed');
    expect(payload.body).toContain('blocked');
    expect(payload.severity).toBe('warning');
  });

  it('formats limit reached', () => {
    const event: NotificationEvent = { type: 'limit_reached', limit: 'maxCostPerRun', value: '$50.00' };
    const payload = formatNotification(event);
    expect(payload.title).toContain('Limit Reached');
    expect(payload.title).toContain('maxCostPerRun');
    expect(payload.body).toContain('$50.00');
    expect(payload.severity).toBe('warning');
  });

  it('always includes a timestamp', () => {
    const event: NotificationEvent = { type: 'anomaly', anomaly: makeAnomaly() };
    const payload = formatNotification(event);
    expect(payload.timestamp).toBeDefined();
    expect(payload.timestamp.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// sendConsole
// =============================================================================

describe('sendConsole', () => {
  it('logs critical with !!! prefix', () => {
    const deps = makeDeps();
    const payload: NotificationPayload = { title: 'test', body: 'msg', severity: 'critical', timestamp: 'now' };
    sendConsole(payload, deps);
    expect(deps.log).toHaveBeenCalledWith('  [!!!] test: msg');
  });

  it('logs warning with !! prefix', () => {
    const deps = makeDeps();
    const payload: NotificationPayload = { title: 'test', body: 'msg', severity: 'warning', timestamp: 'now' };
    sendConsole(payload, deps);
    expect(deps.log).toHaveBeenCalledWith('  [!!] test: msg');
  });

  it('logs info with i prefix', () => {
    const deps = makeDeps();
    const payload: NotificationPayload = { title: 'test', body: 'msg', severity: 'info', timestamp: 'now' };
    sendConsole(payload, deps);
    expect(deps.log).toHaveBeenCalledWith('  [i] test: msg');
  });
});

// =============================================================================
// sendSlack
// =============================================================================

describe('sendSlack', () => {
  it('sends POST to webhook URL with Slack payload', async () => {
    const deps = makeDeps();
    const payload: NotificationPayload = { title: 'Test', body: 'msg', severity: 'info', timestamp: 'now' };
    const result = await sendSlack(payload, 'https://hooks.slack.com/test', deps);
    expect(result).toBe(true);
    expect(deps.fetch).toHaveBeenCalledWith('https://hooks.slack.com/test', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('includes blocks in Slack payload', async () => {
    const deps = makeDeps();
    const payload: NotificationPayload = { title: 'Test', body: 'msg', severity: 'critical', timestamp: 'now' };
    await sendSlack(payload, 'https://hooks.slack.com/test', deps);
    const body = JSON.parse((deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.text).toContain(':rotating_light:');
    expect(body.blocks).toHaveLength(3);
    expect(body.blocks[0].type).toBe('header');
    expect(body.blocks[1].type).toBe('section');
    expect(body.blocks[2].type).toBe('context');
  });

  it('uses warning emoji for warning severity', async () => {
    const deps = makeDeps();
    const payload: NotificationPayload = { title: 'Test', body: 'msg', severity: 'warning', timestamp: 'now' };
    await sendSlack(payload, 'https://hooks.slack.com/test', deps);
    const body = JSON.parse((deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.text).toContain(':warning:');
  });

  it('uses info emoji for info severity', async () => {
    const deps = makeDeps();
    const payload: NotificationPayload = { title: 'Test', body: 'msg', severity: 'info', timestamp: 'now' };
    await sendSlack(payload, 'https://hooks.slack.com/test', deps);
    const body = JSON.parse((deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.text).toContain(':information_source:');
  });

  it('returns false on non-ok response', async () => {
    const deps = makeDeps({ fetch: vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }) });
    const payload: NotificationPayload = { title: 'Test', body: 'msg', severity: 'info', timestamp: 'now' };
    const result = await sendSlack(payload, 'https://hooks.slack.com/test', deps);
    expect(result).toBe(false);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('500'));
  });

  it('returns false on fetch error', async () => {
    const deps = makeDeps({ fetch: vi.fn().mockRejectedValue(new Error('Network error')) });
    const payload: NotificationPayload = { title: 'Test', body: 'msg', severity: 'info', timestamp: 'now' };
    const result = await sendSlack(payload, 'https://hooks.slack.com/test', deps);
    expect(result).toBe(false);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Network error'));
  });

  it('handles non-Error throw objects', async () => {
    const deps = makeDeps({ fetch: vi.fn().mockRejectedValue('string error') });
    const payload: NotificationPayload = { title: 'Test', body: 'msg', severity: 'info', timestamp: 'now' };
    const result = await sendSlack(payload, 'https://hooks.slack.com/test', deps);
    expect(result).toBe(false);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Unknown error'));
  });
});

// =============================================================================
// sendEmail
// =============================================================================

describe('sendEmail', () => {
  it('sends POST to email webhook URL', async () => {
    const deps = makeDeps();
    const payload: NotificationPayload = { title: 'Subject', body: 'Body', severity: 'info', timestamp: 'now' };
    const result = await sendEmail(payload, 'https://email.api/send', 'admin@test.com', deps);
    expect(result).toBe(true);
    expect(deps.fetch).toHaveBeenCalledWith('https://email.api/send', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('includes to, subject, and body in email payload', async () => {
    const deps = makeDeps();
    const payload: NotificationPayload = { title: 'Subject', body: 'Body', severity: 'warning', timestamp: '2025-01-01' };
    await sendEmail(payload, 'https://email.api/send', 'admin@test.com', deps);
    const body = JSON.parse((deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.to).toBe('admin@test.com');
    expect(body.subject).toBe('Subject');
    expect(body.body).toContain('Body');
    expect(body.body).toContain('warning');
  });

  it('returns false on non-ok response', async () => {
    const deps = makeDeps({ fetch: vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' }) });
    const payload: NotificationPayload = { title: 'Test', body: 'msg', severity: 'info', timestamp: 'now' };
    const result = await sendEmail(payload, 'https://email.api/send', 'a@b.com', deps);
    expect(result).toBe(false);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('403'));
  });

  it('returns false on fetch error', async () => {
    const deps = makeDeps({ fetch: vi.fn().mockRejectedValue(new Error('SMTP down')) });
    const payload: NotificationPayload = { title: 'Test', body: 'msg', severity: 'info', timestamp: 'now' };
    const result = await sendEmail(payload, 'https://email.api/send', 'a@b.com', deps);
    expect(result).toBe(false);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('SMTP down'));
  });

  it('handles non-Error throw objects', async () => {
    const deps = makeDeps({ fetch: vi.fn().mockRejectedValue(42) });
    const payload: NotificationPayload = { title: 'Test', body: 'msg', severity: 'info', timestamp: 'now' };
    const result = await sendEmail(payload, 'https://email.api/send', 'a@b.com', deps);
    expect(result).toBe(false);
  });
});

// =============================================================================
// shouldNotify
// =============================================================================

describe('shouldNotify', () => {
  it('returns true for anomaly when onAnomaly is true', () => {
    expect(shouldNotify({ type: 'anomaly', anomaly: makeAnomaly() }, makeConfig({ onAnomaly: true }))).toBe(true);
  });

  it('returns false for anomaly when onAnomaly is false', () => {
    expect(shouldNotify({ type: 'anomaly', anomaly: makeAnomaly() }, makeConfig({ onAnomaly: false }))).toBe(false);
  });

  it('returns true for task_complete when onComplete is true', () => {
    expect(shouldNotify({ type: 'task_complete', task: makeTask(), success: true }, makeConfig({ onComplete: true }))).toBe(true);
  });

  it('returns false for task_complete when onComplete is false', () => {
    expect(shouldNotify({ type: 'task_complete', task: makeTask(), success: true }, makeConfig({ onComplete: false }))).toBe(false);
  });

  it('returns true for limit_reached when onAnomaly is true', () => {
    expect(shouldNotify({ type: 'limit_reached', limit: 'cost', value: '$50' }, makeConfig({ onAnomaly: true, onComplete: false }))).toBe(true);
  });

  it('returns true for limit_reached when onComplete is true', () => {
    expect(shouldNotify({ type: 'limit_reached', limit: 'cost', value: '$50' }, makeConfig({ onAnomaly: false, onComplete: true }))).toBe(true);
  });

  it('returns false for limit_reached when both flags are false', () => {
    expect(shouldNotify({ type: 'limit_reached', limit: 'cost', value: '$50' }, makeConfig({ onAnomaly: false, onComplete: false }))).toBe(false);
  });
});

// =============================================================================
// resolveNotificationEnv
// =============================================================================

describe('resolveNotificationEnv', () => {
  beforeEach(() => {
    delete process.env.RALPH_SLACK_WEBHOOK_URL;
    delete process.env.RALPH_EMAIL_WEBHOOK_URL;
    delete process.env.RALPH_EMAIL_TO;
  });

  it('returns undefined when env vars are not set', () => {
    const env = resolveNotificationEnv();
    expect(env.slackUrl).toBeUndefined();
    expect(env.emailUrl).toBeUndefined();
    expect(env.emailTo).toBeUndefined();
  });

  it('reads RALPH_SLACK_WEBHOOK_URL', () => {
    process.env.RALPH_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/xxx';
    const env = resolveNotificationEnv();
    expect(env.slackUrl).toBe('https://hooks.slack.com/xxx');
  });

  it('reads RALPH_EMAIL_WEBHOOK_URL and RALPH_EMAIL_TO', () => {
    process.env.RALPH_EMAIL_WEBHOOK_URL = 'https://email.api/send';
    process.env.RALPH_EMAIL_TO = 'admin@test.com';
    const env = resolveNotificationEnv();
    expect(env.emailUrl).toBe('https://email.api/send');
    expect(env.emailTo).toBe('admin@test.com');
  });
});

// =============================================================================
// dispatchNotification
// =============================================================================

describe('dispatchNotification', () => {
  it('returns false when event should not be notified', async () => {
    const deps = makeDeps();
    const result = await dispatchNotification(
      { type: 'task_complete', task: makeTask(), success: true },
      makeConfig({ onComplete: false }),
      deps,
    );
    expect(result).toBe(false);
    expect(deps.log).not.toHaveBeenCalled();
  });

  it('dispatches to console channel', async () => {
    const deps = makeDeps();
    const result = await dispatchNotification(
      { type: 'anomaly', anomaly: makeAnomaly() },
      makeConfig({ channel: 'console' }),
      deps,
    );
    expect(result).toBe(true);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Anomaly Detected'));
  });

  it('dispatches to slack channel', async () => {
    const deps = makeDeps();
    const env = { slackUrl: 'https://hooks.slack.com/test', emailUrl: undefined, emailTo: undefined };
    const result = await dispatchNotification(
      { type: 'anomaly', anomaly: makeAnomaly() },
      makeConfig({ channel: 'slack' }),
      deps,
      env,
    );
    expect(result).toBe(true);
    expect(deps.fetch).toHaveBeenCalled();
  });

  it('returns false for slack without webhook URL', async () => {
    const deps = makeDeps();
    const env = { slackUrl: undefined, emailUrl: undefined, emailTo: undefined };
    const result = await dispatchNotification(
      { type: 'anomaly', anomaly: makeAnomaly() },
      makeConfig({ channel: 'slack' }),
      deps,
      env,
    );
    expect(result).toBe(false);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('RALPH_SLACK_WEBHOOK_URL'));
  });

  it('dispatches to email channel', async () => {
    const deps = makeDeps();
    const env = { slackUrl: undefined, emailUrl: 'https://email.api/send', emailTo: 'admin@test.com' };
    const result = await dispatchNotification(
      { type: 'anomaly', anomaly: makeAnomaly() },
      makeConfig({ channel: 'email' }),
      deps,
      env,
    );
    expect(result).toBe(true);
    expect(deps.fetch).toHaveBeenCalled();
  });

  it('returns false for email without webhook URL', async () => {
    const deps = makeDeps();
    const env = { slackUrl: undefined, emailUrl: undefined, emailTo: 'admin@test.com' };
    const result = await dispatchNotification(
      { type: 'anomaly', anomaly: makeAnomaly() },
      makeConfig({ channel: 'email' }),
      deps,
      env,
    );
    expect(result).toBe(false);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('RALPH_EMAIL_WEBHOOK_URL'));
  });

  it('returns false for email without recipient', async () => {
    const deps = makeDeps();
    const env = { slackUrl: undefined, emailUrl: 'https://email.api/send', emailTo: undefined };
    const result = await dispatchNotification(
      { type: 'anomaly', anomaly: makeAnomaly() },
      makeConfig({ channel: 'email' }),
      deps,
      env,
    );
    expect(result).toBe(false);
  });

  it('returns false for unknown channel', async () => {
    const deps = makeDeps();
    const result = await dispatchNotification(
      { type: 'anomaly', anomaly: makeAnomaly() },
      makeConfig({ channel: 'unknown' as 'console' }),
      deps,
    );
    expect(result).toBe(false);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Unknown notification channel'));
  });

  it('catches dispatch errors', async () => {
    const deps = makeDeps({
      fetch: vi.fn().mockRejectedValue(new Error('fatal')),
    });
    const env = { slackUrl: 'https://hooks.slack.com/test', emailUrl: undefined, emailTo: undefined };
    const result = await dispatchNotification(
      { type: 'anomaly', anomaly: makeAnomaly() },
      makeConfig({ channel: 'slack' }),
      deps,
      env,
    );
    // sendSlack catches internally, returns false
    expect(result).toBe(false);
  });
});

// =============================================================================
// CONVENIENCE HELPERS
// =============================================================================

describe('notifyAnomaly', () => {
  it('dispatches anomaly event', async () => {
    const deps = makeDeps();
    const result = await notifyAnomaly(makeAnomaly(), makeConfig(), deps);
    expect(result).toBe(true);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Anomaly'));
  });

  it('respects onAnomaly=false', async () => {
    const deps = makeDeps();
    const result = await notifyAnomaly(makeAnomaly(), makeConfig({ onAnomaly: false }), deps);
    expect(result).toBe(false);
  });
});

describe('notifyTaskComplete', () => {
  it('dispatches task completion event', async () => {
    const deps = makeDeps();
    const result = await notifyTaskComplete(makeTask(), true, makeConfig({ onComplete: true }), deps);
    expect(result).toBe(true);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Task Completed'));
  });

  it('dispatches task failure event', async () => {
    const deps = makeDeps();
    const result = await notifyTaskComplete(makeTask({ status: 'blocked' }), false, makeConfig({ onComplete: true }), deps);
    expect(result).toBe(true);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Task Failed'));
  });

  it('respects onComplete=false', async () => {
    const deps = makeDeps();
    const result = await notifyTaskComplete(makeTask(), true, makeConfig({ onComplete: false }), deps);
    expect(result).toBe(false);
  });
});

describe('notifyLimitReached', () => {
  it('dispatches limit reached event', async () => {
    const deps = makeDeps();
    const result = await notifyLimitReached('maxCostPerRun', '$50.00', makeConfig(), deps);
    expect(result).toBe(true);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Limit Reached'));
  });

  it('returns false when all notification flags are off', async () => {
    const deps = makeDeps();
    const result = await notifyLimitReached('maxCostPerRun', '$50.00', makeConfig({ onAnomaly: false, onComplete: false }), deps);
    expect(result).toBe(false);
  });
});

// =============================================================================
// INTEGRATION SCENARIOS
// =============================================================================

describe('integration scenarios', () => {
  it('full anomaly flow through slack', async () => {
    const deps = makeDeps();
    const env = { slackUrl: 'https://hooks.slack.com/services/xxx', emailUrl: undefined, emailTo: undefined };
    const config = makeConfig({ channel: 'slack', onAnomaly: true });
    const anomaly = makeAnomaly({ severity: 'high', anomaly: 'Critical issue detected' });

    const result = await dispatchNotification({ type: 'anomaly', anomaly }, config, deps, env);
    expect(result).toBe(true);

    const slackBody = JSON.parse((deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(slackBody.text).toContain(':rotating_light:');
    expect(slackBody.blocks[1].text.text).toBe('Critical issue detected');
  });

  it('full task completion flow through email', async () => {
    const deps = makeDeps();
    const env = { slackUrl: undefined, emailUrl: 'https://email.api/send', emailTo: 'team@company.com' };
    const config = makeConfig({ channel: 'email', onComplete: true });
    const task = makeTask({ id: 'RALPH-042', title: 'Fix critical bug' });

    const result = await dispatchNotification({ type: 'task_complete', task, success: true }, config, deps, env);
    expect(result).toBe(true);

    const emailBody = JSON.parse((deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(emailBody.to).toBe('team@company.com');
    expect(emailBody.subject).toContain('RALPH-042');
  });

  it('no notification when config disables everything', async () => {
    const deps = makeDeps();
    const config = makeConfig({ onAnomaly: false, onComplete: false });

    const r1 = await dispatchNotification({ type: 'anomaly', anomaly: makeAnomaly() }, config, deps);
    const r2 = await dispatchNotification({ type: 'task_complete', task: makeTask(), success: true }, config, deps);
    const r3 = await dispatchNotification({ type: 'limit_reached', limit: 'cost', value: '$50' }, config, deps);

    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(r3).toBe(false);
    expect(deps.log).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
