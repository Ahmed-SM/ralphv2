/**
 * Notifications - Human-on-the-loop notification dispatch
 *
 * Implements the notification system from loop-mechanics spec:
 *   - Notify human on anomaly detection
 *   - Notify human on task completion
 *   - Notify human on limit reached
 *
 * Supports three channels: console, slack (webhook), email (SMTP).
 * Errors in notification delivery are logged but never crash the loop.
 */

import type {
  NotificationConfig,
  Task,
  AnomalyDetectedEvent,
} from '../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export type NotificationEvent =
  | { type: 'anomaly'; anomaly: AnomalyDetectedEvent }
  | { type: 'task_complete'; task: Task; success: boolean }
  | { type: 'limit_reached'; limit: string; value: string };

export interface NotificationPayload {
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
}

/** Injectable dependencies for testability (no real HTTP/SMTP in tests). */
export interface NotificationDeps {
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; statusText: string }>;
  log: (message: string) => void;
}

const defaultDeps: NotificationDeps = {
  fetch: globalThis.fetch as NotificationDeps['fetch'],
  log: (msg: string) => console.log(msg),
};

// =============================================================================
// FORMAT
// =============================================================================

/**
 * Format a notification event into a human-readable payload.
 */
export function formatNotification(event: NotificationEvent): NotificationPayload {
  const timestamp = new Date().toISOString();

  switch (event.type) {
    case 'anomaly': {
      const { anomaly } = event;
      const severity = anomaly.severity === 'high' ? 'critical'
        : anomaly.severity === 'medium' ? 'warning'
        : 'info';
      return {
        title: `[Ralph] Anomaly Detected (${anomaly.severity})`,
        body: anomaly.anomaly,
        severity,
        timestamp,
      };
    }

    case 'task_complete': {
      const { task, success } = event;
      return {
        title: success
          ? `[Ralph] Task Completed: ${task.id}`
          : `[Ralph] Task Failed: ${task.id}`,
        body: `${task.title}${success ? '' : ` (status: ${task.status})`}`,
        severity: success ? 'info' : 'warning',
        timestamp,
      };
    }

    case 'limit_reached': {
      return {
        title: `[Ralph] Limit Reached: ${event.limit}`,
        body: `Current value: ${event.value}`,
        severity: 'warning',
        timestamp,
      };
    }
  }
}

// =============================================================================
// CHANNELS
// =============================================================================

/**
 * Send notification to console (default channel).
 */
export function sendConsole(payload: NotificationPayload, deps: NotificationDeps = defaultDeps): void {
  const prefix = payload.severity === 'critical' ? '!!!'
    : payload.severity === 'warning' ? '!!'
    : 'i';
  deps.log(`  [${prefix}] ${payload.title}: ${payload.body}`);
}

/**
 * Send notification to a Slack webhook.
 *
 * Expects RALPH_SLACK_WEBHOOK_URL environment variable.
 * Uses Slack Block Kit for structured formatting.
 */
export async function sendSlack(
  payload: NotificationPayload,
  webhookUrl: string,
  deps: NotificationDeps = defaultDeps,
): Promise<boolean> {
  const emoji = payload.severity === 'critical' ? ':rotating_light:'
    : payload.severity === 'warning' ? ':warning:'
    : ':information_source:';

  const slackPayload = {
    text: `${emoji} ${payload.title}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: payload.title },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: payload.body },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `*Severity:* ${payload.severity} | *Time:* ${payload.timestamp}` },
        ],
      },
    ],
  };

  try {
    const response = await deps.fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
    });

    if (!response.ok) {
      deps.log(`  Slack notification failed: ${response.status} ${response.statusText}`);
      return false;
    }

    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    deps.log(`  Slack notification failed: ${msg}`);
    return false;
  }
}

/**
 * Send notification via email (SMTP webhook/API).
 *
 * Expects RALPH_EMAIL_WEBHOOK_URL environment variable pointing to
 * an HTTP-to-email bridge (e.g., SendGrid, Mailgun, or custom endpoint).
 *
 * POST { to, subject, body } to the webhook URL.
 */
export async function sendEmail(
  payload: NotificationPayload,
  webhookUrl: string,
  to: string,
  deps: NotificationDeps = defaultDeps,
): Promise<boolean> {
  const emailPayload = {
    to,
    subject: payload.title,
    body: `${payload.body}\n\nSeverity: ${payload.severity}\nTime: ${payload.timestamp}`,
  };

  try {
    const response = await deps.fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload),
    });

    if (!response.ok) {
      deps.log(`  Email notification failed: ${response.status} ${response.statusText}`);
      return false;
    }

    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    deps.log(`  Email notification failed: ${msg}`);
    return false;
  }
}

// =============================================================================
// DISPATCH
// =============================================================================

/**
 * Resolve environment variables for notification channels.
 */
export function resolveNotificationEnv(): { slackUrl?: string; emailUrl?: string; emailTo?: string } {
  return {
    slackUrl: process.env.RALPH_SLACK_WEBHOOK_URL,
    emailUrl: process.env.RALPH_EMAIL_WEBHOOK_URL,
    emailTo: process.env.RALPH_EMAIL_TO,
  };
}

/**
 * Should a notification be sent for a given event + config?
 */
export function shouldNotify(event: NotificationEvent, config: NotificationConfig): boolean {
  switch (event.type) {
    case 'anomaly':
      return config.onAnomaly;
    case 'task_complete':
      return config.onComplete;
    case 'limit_reached':
      // Limits are always notified when any notification is enabled
      return config.onAnomaly || config.onComplete;
  }
}

/**
 * Dispatch a notification event through the configured channel.
 *
 * This is the main entry point for sending notifications. It:
 *   1. Checks if the event should be notified per config
 *   2. Formats the event into a payload
 *   3. Routes to the appropriate channel
 *
 * Errors are caught and logged — never thrown.
 */
export async function dispatchNotification(
  event: NotificationEvent,
  config: NotificationConfig,
  deps: NotificationDeps = defaultDeps,
  env: ReturnType<typeof resolveNotificationEnv> = resolveNotificationEnv(),
): Promise<boolean> {
  if (!shouldNotify(event, config)) {
    return false;
  }

  const payload = formatNotification(event);

  try {
    switch (config.channel) {
      case 'console':
        sendConsole(payload, deps);
        return true;

      case 'slack': {
        if (!env.slackUrl) {
          deps.log('  Notification skipped: RALPH_SLACK_WEBHOOK_URL not set');
          return false;
        }
        return await sendSlack(payload, env.slackUrl, deps);
      }

      case 'email': {
        if (!env.emailUrl || !env.emailTo) {
          deps.log('  Notification skipped: RALPH_EMAIL_WEBHOOK_URL or RALPH_EMAIL_TO not set');
          return false;
        }
        return await sendEmail(payload, env.emailUrl, env.emailTo, deps);
      }

      default:
        deps.log(`  Unknown notification channel: ${config.channel}`);
        return false;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    deps.log(`  Notification dispatch failed: ${msg}`);
    return false;
  }
}

// =============================================================================
// LOOP INTEGRATION HELPERS
// =============================================================================

/**
 * Notify on anomaly detection. Called from the onAnomaly hook.
 */
export async function notifyAnomaly(
  anomaly: AnomalyDetectedEvent,
  config: NotificationConfig,
  deps?: NotificationDeps,
  env?: ReturnType<typeof resolveNotificationEnv>,
): Promise<boolean> {
  return dispatchNotification({ type: 'anomaly', anomaly }, config, deps, env);
}

/**
 * Notify on task completion/failure. Called after task processing.
 */
export async function notifyTaskComplete(
  task: Task,
  success: boolean,
  config: NotificationConfig,
  deps?: NotificationDeps,
  env?: ReturnType<typeof resolveNotificationEnv>,
): Promise<boolean> {
  return dispatchNotification({ type: 'task_complete', task, success }, config, deps, env);
}

/**
 * Notify on limit reached. Called when loop/task limits are hit.
 */
export async function notifyLimitReached(
  limit: string,
  value: string,
  config: NotificationConfig,
  deps?: NotificationDeps,
  env?: ReturnType<typeof resolveNotificationEnv>,
): Promise<boolean> {
  return dispatchNotification({ type: 'limit_reached', limit, value }, config, deps, env);
}
