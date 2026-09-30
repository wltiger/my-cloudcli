import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, DiffLine, NormalizedMessage } from '@/shared/types';

/**
 * Antigravity records the images a tool produced (a screenshot, a generated
 * picture) on the tool result, as urls under its media route. They were dropped
 * when the tool row was built, and nothing could load them: the route needs the
 * auth header, so a bare <img src> is rejected.
 *
 * The thumbnails sit on the tool row itself. `Read` hides its result by config
 * and `Bash` hides it on success, so thumbnails inside the result block would
 * vanish with it.
 */

const MEDIA = [{
  url: '/api/providers/antigravity/media/conversation-1/media_1.png',
  name: 'media_1.png',
  mimeType: 'image/png',
}];

const readRow = (): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: '2026-09-30T10:00:00.000Z',
  isToolUse: true,
  toolName: 'Read',
  toolId: 'tool-1',
  toolInput: JSON.stringify({ file_path: 'C:/work/shot.png' }),
  toolResult: { content: 'Viewed image', isError: false, media: MEDIA },
});

const createDiff = (): DiffLine[] => [];

const renderRow = () => render(
  <UiPreferencesProvider>
    <MessageComponent message={readRow()} prevMessage={null} createDiff={createDiff} provider="antigravity" />
  </UiPreferencesProvider>,
);

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.setItem('auth-token', 'test-token');
  vi.stubGlobal('fetch', fetchMock);
  // jsdom implements neither.
  Object.assign(URL, { createObjectURL: () => 'blob:thumbnail', revokeObjectURL: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('the tool row keeps the media its result recorded', () => {
  const [row] = normalizedToChatMessages([{
    id: 'tool-1',
    sessionId: 'session-1',
    timestamp: '2026-09-30T10:00:00.000Z',
    provider: 'antigravity',
    kind: 'tool_use',
    toolId: 'tool-1',
    toolName: 'Read',
    toolInput: { file_path: 'C:/work/shot.png' },
    toolResult: { content: 'Viewed image', isError: false, media: MEDIA },
  } as NormalizedMessage]);

  assert.deepEqual(row?.toolResult?.media, MEDIA);
});

test('a thumbnail shows on a row whose result is hidden, fetched with the auth header', async () => {
  fetchMock.mockImplementation(async () => new Response('png-bytes', { status: 200 }));

  renderRow();

  const image = await screen.findByRole('img', { name: 'media_1.png' });
  assert.equal(image.getAttribute('src'), 'blob:thumbnail');
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  assert.equal(url, MEDIA[0].url);
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-token');
});

test('a missing image renders a placeholder, not a broken image', async () => {
  fetchMock.mockImplementation(async () => new Response('', { status: 404 }));

  renderRow();

  assert.ok(await screen.findByText('media_1.png'));
  assert.equal(screen.queryByRole('img', { name: 'media_1.png' }), null);
});
