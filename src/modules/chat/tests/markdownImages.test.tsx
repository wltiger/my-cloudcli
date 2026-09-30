import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { Markdown } from '@/modules/chat/transcript/Markdown';

/**
 * `agy` links screenshots into its prose by local path, and the backend points
 * the ones inside the conversation at its media route. react-markdown keeps
 * that url — it is relative — where it blanked the local path, but the route
 * wants the auth header a bare <img src> cannot send. So an image under
 * `/api/` is fetched as a blob, like every other authenticated chat image.
 */

const MEDIA_URL = '/api/providers/antigravity/media/conv-1/01-guide-buttons.png';

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.setItem('auth-token', 'test-token');
  vi.stubGlobal('fetch', fetchMock);
  // jsdom implements neither.
  Object.assign(URL, { createObjectURL: () => 'blob:screenshot', revokeObjectURL: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  localStorage.clear();
});

test('a media route image is fetched with the auth header and shown from the blob', async () => {
  fetchMock.mockImplementation(async () => new Response('png-bytes', { status: 200 }));

  render(<Markdown>{`以下是修改后的效果：\n\n![第1步：首页](${MEDIA_URL})`}</Markdown>);

  const image = await screen.findByRole('img', { name: '第1步：首页' });
  assert.equal(image.getAttribute('src'), 'blob:screenshot');
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  assert.equal(url, MEDIA_URL);
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-token');
});

test('a media route image that cannot be fetched shows its alt text, not a broken image', async () => {
  fetchMock.mockImplementation(async () => new Response('', { status: 404 }));

  render(<Markdown>{`![第1步：首页](${MEDIA_URL})`}</Markdown>);

  assert.ok(await screen.findByText('第1步：首页'));
  assert.equal(screen.queryByRole('img'), null);
});

test('an image on the web renders as it always did, with no fetch', () => {
  render(<Markdown>{'![logo](https://example.com/logo.png "Logo")'}</Markdown>);

  const image = screen.getByRole('img', { name: 'logo' });
  assert.equal(image.getAttribute('src'), 'https://example.com/logo.png');
  assert.equal(image.getAttribute('title'), 'Logo');
  assert.equal(fetchMock.mock.calls.length, 0);
});
