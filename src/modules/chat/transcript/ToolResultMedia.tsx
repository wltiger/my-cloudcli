import type { ToolResult } from '@/shared/types';
import { ChatMessageImage } from '@/modules/chat/transcript/ChatMessageImages';
import type { ChatImageSource } from '@/modules/chat/transcript/ChatMessageImages';

/**
 * Thumbnails for the images a tool result recorded — Antigravity's screenshots
 * and generated images, each addressed by a url the server built for it.
 *
 * Drawn on the tool row rather than inside the result block: several configs
 * hide that block (Read always, Bash on success), and the images would go with
 * it.
 *
 * Rendered by chat's MessageComponent under a tool call.
 */
export default function ToolResultMedia({ toolResult }: { toolResult?: ToolResult | null }) {
  const media = toolResult?.media;
  if (!Array.isArray(media) || media.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {media.map((image: ChatImageSource) => (
        <ChatMessageImage key={image.url} image={image} />
      ))}
    </div>
  );
}
