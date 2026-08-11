// scheduledTriggersRoutes: mounted by the server entrypoint under /api/scheduled-triggers.
export { default as scheduledTriggersRoutes } from '@/modules/scheduled-triggers/scheduled-triggers.routes.js';
// startScheduledTriggerPoller/stopScheduledTriggerPoller: started/stopped by the server entrypoint.
export {
  startScheduledTriggerPoller,
  stopScheduledTriggerPoller,
} from '@/modules/scheduled-triggers/services/scheduler-poller.service.js';
// createScheduledTriggerService: exposed for tests to inject fake dependencies.
export {
  createScheduledTriggerService,
  scheduledTriggerService,
} from '@/modules/scheduled-triggers/services/scheduled-trigger.service.js';
export type { ScheduledTriggerServiceDependencies } from '@/modules/scheduled-triggers/services/scheduled-trigger.service.js';
