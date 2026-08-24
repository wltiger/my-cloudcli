import { randomUUID } from 'node:crypto';

import { sessionsDb } from '@/modules/database/index.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError, UNTITLED_SESSION_NAME } from '@/shared/utils.js';

/**
 * Fixed English literal, written into the retired session's name rather than
 * rendered as a badge or translated: it has to survive a language switch, and
 * the sidebar's existing inline rename has to be able to edit it afterwards.
 */
const CLEARED_NAME_PREFIX = '[Cleared]';

type ClearedSession = {
  /** The empty session that takes over. */
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
  /** The conversation that was retired: archived, whole, and still resumable. */
  retiredSessionId: string;
  retiredSessionName: string;
};

/**
 * Builds the name the retired conversation is renamed to.
 *
 * Exported for `tests/session-clear.service.test.ts`, which is where the prefix
 * rule is pinned. Clearing an already cleared session nests the prefix instead
 * of replacing it, matching `buildForkSessionName`: the name records that a
 * Clear happened, and the reader can still rename it from the sidebar.
 *
 * @param originalName The session's name as the sidebar shows it.
 */
export function buildClearedSessionName(originalName: string): string {
  return `${CLEARED_NAME_PREFIX} ${originalName.trim() || UNTITLED_SESSION_NAME}`;
}

/**
 * Application service for Clear: retiring the open conversation and continuing
 * in an empty one.
 *
 * Clear touches no provider API at all — it is a session boundary, not a
 * context operation. The retired conversation is archived and renamed rather
 * than emptied or deleted, so nothing it contained becomes unreadable (ADR
 * 0005). That archive is durable only because the retired row is never written
 * again: the session upsert resets `isArchived` on every write and the
 * synchronizer is incremental, which is also what makes a retired session
 * un-archive itself the moment the reader resumes it.
 */
export const sessionClearService = {
  /**
   * Archives and renames one session, then opens an empty session beside it in
   * the same project.
   */
  clearSession(sessionId: string): ClearedSession {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const provider = session.provider as LLMProvider;
    if (!providerCapabilitiesService.getProviderCapabilities(provider)?.supportsClear) {
      throw new AppError(`Provider "${provider}" cannot clear a session.`, {
        code: 'CLEAR_NOT_SUPPORTED',
        statusCode: 400,
      });
    }

    const projectPath = session.project_path ?? '';
    const retiredSessionName = buildClearedSessionName(session.custom_name ?? '');
    sessionsDb.updateSessionCustomName(sessionId, retiredSessionName);
    sessionsDb.updateSessionIsArchived(sessionId, true);

    // Deliberately unnamed: this is the app-session shape the session gateway
    // allocates for a brand-new chat, and the upsert's custom_name CASE only
    // lets a synchronized title land while the name is still NULL.
    const openedSessionId = randomUUID();
    sessionsDb.createAppSession(openedSessionId, provider, projectPath);

    // The reader is continuing the same work, so the empty session inherits the
    // runtime configuration rather than snapping back to the provider default.
    if (session.model) {
      sessionsDb.setSessionModel(openedSessionId, session.model);
    }
    if (session.effort) {
      sessionsDb.setSessionEffort(openedSessionId, session.effort);
    }

    return {
      sessionId: openedSessionId,
      provider,
      projectPath,
      retiredSessionId: sessionId,
      retiredSessionName,
    };
  },
};
