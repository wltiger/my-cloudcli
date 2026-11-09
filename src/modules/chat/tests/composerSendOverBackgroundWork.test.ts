import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { notifyBackgroundWorkRefused, notifyRunSettled } from '@/modules/chat/utils/backgroundWorkRefusal';
import { clearQueuedMessage, readDraftText, readQueuedMessage, writeDraftText } from '@/shared/chatDrafts';
import type * as ChatDrafts from '@/shared/chatDrafts';
import type { BackgroundSendChoice, PermissionMode, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * A session whose turn has ended with background work still running keeps
 * its composer usable. An ordinary send (Enter, or Send in the send menu)
 * asks nothing: the server pushes it into the process holding that work,
 * which keeps running. Only when the server refuses — the held process cannot
 * take the message — does the background-work dialog open, and its choice
 * acts on the refused message: Send anyway (stops the work first), Queue,
 * Side question, or Cancel. The send menu can make the same choices up front.
 */

const { appendQueuedMessage } = vi.hoisted(() => ({ appendQueuedMessage: vi.fn() }));

vi.mock('@/shared/chatDrafts', async (importOriginal) => {
  const actual = await importOriginal<typeof ChatDrafts>();
  return {
    ...actual,
    appendQueuedMessage: (...args: Parameters<typeof actual.appendQueuedMessage>) => {
      appendQueuedMessage(...args);
      return actual.appendQueuedMessage(...args);
    },
  };
});

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };
const UPLOADED = { name: 'notes.txt', path: '/uploads/notes.txt', mimeType: 'text/plain', size: 5 };

const backgroundOnly: SessionActivityMap = new Map([[
  'session-1',
  {
    statusText: null,
    canInterrupt: false,
    startedAt: 1,
    background: true,
    tasks: [
      { taskId: 'w1', toolUseId: 'toolu_wf', taskType: 'local_workflow', description: 'Audit the frontend', workflowName: 'frontend-architecture-audit', startedAt: 1 },
      { taskId: 'b1', toolUseId: 'toolu_inner', taskType: 'local_bash', description: 'Sleep for 60 seconds', startedAt: 2, nested: true },
      { taskId: 'a1', toolUseId: 'toolu_agent', taskType: 'local_agent', description: 'Survey the repo', startedAt: 3 },
    ],
  },
]]);

const uploads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/assets/files'));

const render = (processingSessions: SessionActivityMap, isLoading = false) => {
  const sent: Array<{ type: string; interruptBackground?: boolean }> = [];
  const view = renderHook(({ session }: { session: ProjectSession }) =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: session,
      currentSessionId: session.id,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      currentProviderSupportsCompact: true,
      currentProviderSupportsClear: true,
      isLoading,
      processingSessions,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string; interruptBackground?: boolean }); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  { initialProps: { session: SESSION } },
  );
  const sends = () => sent.filter((message) => message.type === 'chat.send');
  const frames = () => sent;
  return { view, sends, frames };
};

type View = ReturnType<typeof render>['view'];

const submit = async (view: View) => {
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
};

// The server refuses the last send: waits for the dialog the refusal opens.
const refuse = async (view: View, sessionId = 'session-1') => {
  await act(async () => { notifyBackgroundWorkRefused(sessionId); });
  await waitFor(() => assert.notEqual(view.result.current.backgroundSendPrompt, null));
};

const answer = async (view: View, choice: BackgroundSendChoice) => {
  await act(async () => { view.result.current.resolveBackgroundSendPrompt(choice); });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/api/assets/files')) {
      return new Response(JSON.stringify({ attachments: [UPLOADED] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/api/user/drafts/queued-message') && init?.method === 'POST') {
      // Nothing else is queued: the server queues the message on its own.
      const { queuedMessage } = JSON.parse(String(init.body)) as { queuedMessage: unknown };
      return new Response(JSON.stringify({ success: true, queuedMessage, appended: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  // The drafts store is module state; a message queued by one test must not
  // be restored into the next one's composer.
  clearQueuedMessage(SESSION.id);
  writeDraftText('session-1', '');
  appendQueuedMessage.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('an ordinary send over background work asks nothing and does not ask the server to stop the work', async () => {
  const { view, sends } = render(backgroundOnly);
  await act(async () => { view.result.current.setInput('hello'); });

  await submit(view);

  assert.equal(view.result.current.backgroundSendPrompt, null, 'no dialog: the held process takes the message in');
  assert.equal(sends().length, 1);
  assert.equal(sends()[0]?.interruptBackground, undefined, 'no interrupt flag on an ordinary send');
  assert.equal(view.result.current.input, '', 'the composer is cleared as for any send');
});

test('Send in the send menu is the same ordinary send', async () => {
  const { view, sends } = render(backgroundOnly);
  await act(async () => { view.result.current.setInput('hello'); });

  await act(async () => { await view.result.current.handleSendMenuChoice('sendKeep'); });

  assert.equal(view.result.current.backgroundSendPrompt, null);
  assert.equal(sends().length, 1);
  assert.equal(sends()[0]?.interruptBackground, undefined);
});

test('Send anyway in the send menu sends the message with the interrupt flag on the top level of the frame', async () => {
  const { view, sends } = render(backgroundOnly);
  await act(async () => { view.result.current.setInput('hello'); });

  await act(async () => { await view.result.current.handleSendMenuChoice('send'); });

  assert.equal(view.result.current.backgroundSendPrompt, null, 'the menu already asked');
  assert.equal(sends().length, 1);
  assert.equal(sends()[0]?.interruptBackground, true);
  assert.equal(appendQueuedMessage.mock.calls.length, 0, 'an interrupt is a send, not a queue');
});

test('Queue in the send menu persists the message behind the work with its uploaded files, sends nothing, and clears the composer', async () => {
  const { view, sends } = render(backgroundOnly);
  await act(async () => {
    view.result.current.setInput('hello');
    view.result.current.setAttachedFiles([new File(['notes'], 'notes.txt', { type: 'text/plain' })]);
  });

  await act(async () => { await view.result.current.handleSendMenuChoice('queue'); });

  assert.equal(sends().length, 0, 'queued: nothing is sent now');
  assert.equal(uploads().length, 1, 'the files are uploaded once');
  assert.equal(appendQueuedMessage.mock.calls.length, 1);
  assert.equal(appendQueuedMessage.mock.calls[0]?.[0], 'session-1');
  const stored = readQueuedMessage('session-1');
  assert.equal(stored?.content, 'hello');
  assert.deepEqual(stored?.attachments, [UPLOADED]);
  assert.equal(stored?.options?.model, 'test-model');
  assert.equal(stored?.waitFor, 'background', 'queued over the work on purpose, it waits for it');
  assert.equal(view.result.current.queuedDraft?.content, 'hello', 'the queued card shows the message');
  assert.equal(view.result.current.input, '', 'and the composer is cleared, as when queueing during a turn');
  assert.equal(view.result.current.attachedFiles.length, 0);
});

test('a refused send opens the dialog naming the session\'s own tasks, with the message and its files back in the composer', async () => {
  const { view, sends } = render(backgroundOnly);
  await act(async () => {
    view.result.current.setInput('hello');
    view.result.current.setAttachedFiles([new File(['notes'], 'notes.txt', { type: 'text/plain' })]);
  });
  await submit(view);
  assert.equal(view.result.current.input, '', 'the composer is cleared on send');

  await refuse(view);

  assert.deepEqual(view.result.current.backgroundSendPrompt, {
    work: ['Workflow frontend-architecture-audit', 'Agent Survey the repo'],
  });
  assert.equal(view.result.current.input, 'hello', 'the refused message is back in the composer');
  assert.equal(view.result.current.attachedFiles.length, 1, 'and so are its files');
  assert.equal(sends().length, 1, 'nothing more is sent while the dialog is open');

  await answer(view, 'cancel');
});

test('after a refusal, cancel sends nothing more and keeps the message in the composer', async () => {
  const { view, sends } = render(backgroundOnly);
  await act(async () => { view.result.current.setInput('hello'); });
  await submit(view);
  await refuse(view);

  await answer(view, 'cancel');

  assert.equal(sends().length, 1, 'only the refused send');
  assert.equal(appendQueuedMessage.mock.calls.length, 0, 'and nothing is queued');
  assert.equal(view.result.current.input, 'hello');
  assert.equal(view.result.current.backgroundSendPrompt, null, 'and the dialog closes');
});

test('after a refusal, Send anyway re-sends the same message with the interrupt flag and clears the composer', async () => {
  const { view, sends } = render(backgroundOnly);
  await act(async () => {
    view.result.current.setInput('hello');
    view.result.current.setAttachedFiles([new File(['notes'], 'notes.txt', { type: 'text/plain' })]);
  });
  await submit(view);
  await refuse(view);

  await answer(view, 'send');

  await waitFor(() => assert.equal(sends().length, 2));
  const resent = sends()[1] as { content?: string; interruptBackground?: boolean; options?: { attachments?: unknown[] } };
  assert.equal(resent.interruptBackground, true);
  assert.equal(resent.content, 'hello');
  assert.deepEqual(resent.options?.attachments, [UPLOADED], 'the files uploaded for the first attempt are reused');
  assert.equal(uploads().length, 1, 'and not uploaded again');
  assert.equal(view.result.current.input, '');
  assert.equal(view.result.current.attachedFiles.length, 0);
});

test('after a refusal, Queue persists the refused message without uploading its files again', async () => {
  const { view, sends } = render(backgroundOnly);
  await act(async () => {
    view.result.current.setInput('hello');
    view.result.current.setAttachedFiles([new File(['notes'], 'notes.txt', { type: 'text/plain' })]);
  });
  await submit(view);
  await refuse(view);

  await answer(view, 'queue');

  await waitFor(() => assert.equal(appendQueuedMessage.mock.calls.length, 1));
  assert.equal(sends().length, 1, 'only the refused send');
  assert.equal(uploads().length, 1);
  const stored = readQueuedMessage('session-1');
  assert.equal(stored?.content, 'hello');
  assert.deepEqual(stored?.attachments, [UPLOADED]);
  assert.equal(stored?.waitFor, 'background');
  await waitFor(() => assert.equal(view.result.current.input, ''));
});

test('a message queued while a turn runs waits only for that turn, even with background work outstanding', async () => {
  const { view, sends } = render(backgroundOnly, true);
  await act(async () => { view.result.current.setInput('after this turn'); });

  await submit(view);

  assert.equal(sends().length, 0, 'queued, not sent');
  assert.equal(readQueuedMessage('session-1')?.waitFor, 'turn', 'it goes out when the turn ends, into the held process');
});

test('an edited message refused over background work is re-sent as the same edit', async () => {
  const { view, frames } = render(backgroundOnly);
  await act(async () => {
    view.result.current.beginEditMessage({ type: 'user', content: 'hello', transcriptAnchorId: 'anchor-7', timestamp: new Date() } as never);
  });
  await act(async () => { view.result.current.setInput('hello again'); });
  await submit(view);
  await refuse(view);

  await answer(view, 'send');

  await waitFor(() => assert.equal(frames().length, 2));
  const resent = frames()[1] as { type: string; anchorId?: string; interruptBackground?: boolean };
  assert.equal(resent.type, 'chat.edit-send', 'an edit stays an edit');
  assert.equal(resent.anchorId, 'anchor-7');
  assert.equal(resent.interruptBackground, true);
});

test('a refusal for a session the user has left puts the message into that session\'s draft and asks nothing', async () => {
  const { view } = render(backgroundOnly);
  await act(async () => { view.result.current.setInput('hello'); });
  await submit(view);

  view.rerender({ session: { id: 'session-2' } });
  await act(async () => { notifyBackgroundWorkRefused('session-1'); });

  assert.equal(view.result.current.backgroundSendPrompt, null, 'no dialog for a session that is not open');
  assert.equal(readDraftText('session-1'), 'hello', 'the message waits in its own session\'s draft');
  assert.notEqual(view.result.current.input, 'hello', 'and not in the session now open');
});

test('a refusal after the send\'s run has settled is not this tab\'s send any more', async () => {
  const { view } = render(backgroundOnly);
  await act(async () => { view.result.current.setInput('hello'); });
  await submit(view);

  await act(async () => { notifyRunSettled('session-1'); });
  await act(async () => { notifyBackgroundWorkRefused('session-1'); });

  assert.equal(view.result.current.backgroundSendPrompt, null);
  assert.equal(view.result.current.input, '', 'an old message is not put back');
});

test('a refusal for another session leaves the composer alone', async () => {
  const { view } = render(backgroundOnly);
  await act(async () => { view.result.current.setInput('hello'); });
  await submit(view);

  await act(async () => { notifyBackgroundWorkRefused('some-other-session'); });

  assert.equal(view.result.current.input, '');
  assert.equal(view.result.current.backgroundSendPrompt, null);
});

test('a session with nothing in the background sends without asking', async () => {
  const { view, sends } = render(new Map());
  await act(async () => { view.result.current.setInput('hello'); });
  await submit(view);

  assert.equal(view.result.current.backgroundSendPrompt, null);
  assert.equal(sends().length, 1);
});
