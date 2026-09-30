import type React from 'react';

import { ChatMessageImage } from '@/modules/chat/transcript/ChatMessageImages';

type MarkdownImageProps = React.ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };

/**
 * One `![alt](src)` in rendered markdown.
 *
 * An image the server addressed under its own `/api/` routes — an Antigravity
 * screenshot the backend pointed at its media route — needs the auth header a
 * bare <img> cannot send, so it is fetched as a blob and shown the way chat
 * shows every other fetched image: a thumbnail that opens a lightbox, and a
 * labelled placeholder when the fetch fails. Any other image renders as
 * markdown always rendered it.
 *
 * Used by chat's Markdown for every markdown image.
 */
export function MarkdownImage({ node: _node, src, alt, ...props }: MarkdownImageProps) {
  if (typeof src === 'string' && src.startsWith('/api/')) {
    return <ChatMessageImage image={{ url: src, name: alt }} />;
  }

  return <img src={src} alt={alt} {...props} />;
}
