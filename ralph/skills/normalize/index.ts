/**
 * Normalize Module
 *
 * Handles task normalization and tracker synchronization.
 */

// Export tracker interface
export * from './tracker-interface.js';

// Export sync functionality
export * from './sync.js';

// Export issue skills
export * from './create-issue.js';
export * from './update-status.js';

// Import adapters to register them
import '../../integrations/jira/adapter.js';
