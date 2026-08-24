import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError, UNTITLED_SESSION_NAME } from '@/shared/utils.js';

const FORK_NAME_PREFIX = '[Fork]';

type ForkedSession = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
  sessionName: string;
};

/**
 * Builds the name the Fork dialog opens pre-filled with.
 *
 * Exported for `tests/session-fork.service.test.ts`, which is where the naming
 * rule is pinned: the reader can still edit or clear whatever this returns, so
 * this only has to be a sensible starting point, not a unique key.
 *
 * @param originalName The source session's name as the sidebar shows it.
 * @param existingNames Every session name already used in the same project.
 */
export function buildForkSessionName(originalName: string, existingNames: string[]): string {
  const base = `${FORK_NAME_PREFIX} ${originalName.trim() || UNTITLED_SESSION_NAME}`;
  const taken = new Set(existingNames.map((name) => name.trim()));

  if (!taken.has(base)) {
    return base;
  }

  // Forking the same message twice is normal, so the sequence starts where a
  // reader would expect the second copy to be numbered.
  let sequence = 2;
  while (taken.has(`${base} (${sequence})`)) {
    sequence += 1;
  }
  return `${base} (${sequence})`;
}

/**
 * Application service for Fork: copying a session's transcript up to an Anchor
 * into a new session, leaving the original untouched and still resumable.
 *
 * The provider owns the copy itself (through the `sessions` facet) because
 * providers disagree about whether the anchored row is kept or dropped. What
 * happens on CloudCLI's side of it — allocating the app-facing session id,
 * naming the fork, and inheriting the source session's runtime configuration —
 * is provider-independent and lives here.
 */
export const sessionForkService = {
  /**
   * Returns the pre-filled name for one session's Fork dialog.
   *
   * Resolved on the backend because the frontend's project payloads are
   * paginated: the names it holds are only the first page, so it cannot tell
   * whether a name is already taken.
   */
  suggestForkName(sessionId: string): { suggestedName: string } {
    const session = readSessionOrThrow(sessionId);
    const siblings = session.project_path
      ? sessionsDb.getSessionsByProjectPathIncludingArchived(session.project_path)
      : [];

    return {
      suggestedName: buildForkSessionName(
        session.custom_name ?? '',
        siblings.map((sibling) => sibling.custom_name ?? ''),
      ),
    };
  },

  /**
   * Forks one session at `anchor` and registers the copy as a new session.
   */
  async forkSession(sessionId: string, anchor: string, title: string): Promise<ForkedSession> {
    const session = readSessionOrThrow(sessionId);
    const provider = session.provider as LLMProvider;
    const providerSessions = providerRegistry.resolveProvider(provider).sessions;

    if (!providerSessions.forkSession) {
      throw new AppError(`Provider "${provider}" cannot fork a session.`, {
        code: 'FORK_NOT_SUPPORTED',
        statusCode: 400,
      });
    }

    if (!session.provider_session_id) {
      throw new AppError('This session has not been started yet.', {
        code: 'PROVIDER_SESSION_ID_NOT_AVAILABLE',
        statusCode: 409,
      });
    }

    const projectPath = session.project_path ?? '';
    const sessionName = title.trim() || buildForkSessionName(session.custom_name ?? '', []);

    const forkedProviderSessionId = await providerSessions.forkSession({
      providerSessionId: session.provider_session_id,
      projectPath,
      anchor,
      title: sessionName,
    });

    const forkedSessionId = randomUUID();
    sessionsDb.createAppSession(forkedSessionId, provider, projectPath, sessionName);
    sessionsDb.assignProviderSessionId(forkedSessionId, forkedProviderSessionId);

    // The provider wrote the fork's transcript next to the original's. Index it
    // now — exactly as the sessions watcher would on its next pass — so the
    // fork opens with its history instead of looking empty until that happens.
    if (session.jsonl_path) {
      sessionsDb.createSession(
        forkedProviderSessionId,
        provider,
        projectPath,
        undefined,
        undefined,
        undefined,
        path.join(path.dirname(session.jsonl_path), `${forkedProviderSessionId}.jsonl`),
      );
    }

    if (session.model) {
      sessionsDb.setSessionModel(forkedSessionId, session.model);
    }
    if (session.effort) {
      sessionsDb.setSessionEffort(forkedSessionId, session.effort);
    }

    return { sessionId: forkedSessionId, provider, projectPath, sessionName };
  },
};

function readSessionOrThrow(sessionId: string) {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    throw new AppError(`Session "${sessionId}" was not found.`, {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }
  return session;
}
