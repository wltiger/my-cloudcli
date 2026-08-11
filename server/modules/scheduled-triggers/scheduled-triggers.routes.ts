import express from 'express';

import { scheduledTriggerService } from '@/modules/scheduled-triggers/services/scheduled-trigger.service.js';
import type { ScheduledTriggerRow } from '@/modules/database/index.js';

const router = express.Router();

function readUserId(req: express.Request): number | null {
  const userId = Number((req as any).user?.id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function serializeTrigger(row: ScheduledTriggerRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    triggerAt: row.trigger_at,
    messageContent: row.message_content,
    status: row.status,
    createdAt: row.created_at,
    firedAt: row.fired_at,
    error: row.error,
  };
}

router.post('/', (req, res) => {
  try {
    const { sessionId, triggerAt, messageContent } = req.body || {};
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const parsedTriggerAt = new Date(triggerAt);
    if (Number.isNaN(parsedTriggerAt.getTime())) {
      return res.status(400).json({ error: 'triggerAt must be a valid date' });
    }

    const trigger = scheduledTriggerService.createScheduledTrigger({
      sessionId,
      userId: readUserId(req),
      triggerAt: parsedTriggerAt,
      messageContent: typeof messageContent === 'string' ? messageContent : undefined,
    });

    return res.json({ success: true, trigger: serializeTrigger(trigger) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ error: message });
  }
});

router.get('/', (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const triggers = scheduledTriggerService.listScheduledTriggersForSession(sessionId).map(serializeTrigger);
  return res.json({ success: true, triggers });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const cancelled = scheduledTriggerService.cancelScheduledTrigger(id);
  if (!cancelled) {
    return res.status(404).json({ error: 'Trigger not found or already resolved' });
  }

  return res.json({ success: true });
});

export default router;
