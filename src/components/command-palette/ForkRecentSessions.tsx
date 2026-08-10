import { History } from 'lucide-react';

import { CommandGroup, CommandItem } from '../../shared/view/ui';
import type { LLMProvider } from '../../types/app';
import { authenticatedFetch } from '../../utils/api';

import { useApiSource } from './sources/useApiSource';

/**
 * Recent sessions across every project.
 *
 * Upstream's Sessions group is scoped to the selected project — the same set
 * the sidebar already shows. This group is what makes the palette usable as a
 * switcher: it answers "what was I just working in", whichever project that
 * was. Kept in a fork-owned file so upstream's palette only gains one line.
 */

const RECENT_LIMIT = 20;
const COLLAPSED_LIMIT = 5;

type RecentSessionRow = {
  id: string;
  label: string;
  projectName: string | null;
  provider?: LLMProvider;
};

interface RecentSessionsResponse {
  data?: {
    sessions?: Array<{
      sessionId: string;
      provider?: string;
      name?: string | null;
      projectName?: string | null;
    }>;
  };
}

function useRecentSessionsSource(enabled: boolean) {
  return useApiSource<RecentSessionRow, RecentSessionsResponse>({
    enabled,
    deps: [],
    fetcher: (signal) =>
      authenticatedFetch(`/api/providers/sessions/recent?limit=${RECENT_LIMIT}`, { signal }),
    parse: (raw) => (raw.data?.sessions ?? []).map<RecentSessionRow>((session) => ({
      id: session.sessionId,
      label: session.name || session.sessionId,
      projectName: session.projectName ?? null,
      provider: session.provider as LLMProvider | undefined,
    })),
  });
}

type ForkRecentSessionsProps = {
  enabled: boolean;
  expanded: boolean;
  /** Sessions already listed by upstream's project-scoped group. */
  excludeIds: string[];
  onSelect: (sessionId: string) => void;
};

export default function ForkRecentSessions({
  enabled,
  expanded,
  excludeIds,
  onSelect,
}: ForkRecentSessionsProps) {
  const sessions = useRecentSessionsSource(enabled);

  // At most RECENT_LIMIT rows, so filtering per render costs nothing and keeps
  // the component free of dependency bookkeeping over an array prop.
  const rows = sessions.filter((session) => !excludeIds.includes(session.id));
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_LIMIT);

  if (shown.length === 0) {
    return null;
  }

  return (
    <CommandGroup heading="Recent sessions (all projects)">
      {shown.map((session) => (
        <CommandItem
          key={session.id}
          value={`recent ${session.label} ${session.projectName ?? ''} ${session.id}`.trim()}
          onSelect={() => onSelect(session.id)}
        >
          <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{session.label}</span>
            {session.projectName && (
              <span className="truncate text-xs text-muted-foreground">{session.projectName}</span>
            )}
          </div>
          {session.provider && (
            <span className="text-xs text-muted-foreground">{session.provider}</span>
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
