import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';

import type { AntigravityGrantOutcome, AntigravityRefusalNotice } from '@/shared/types';

type AntigravityPermissionNoticeProps = {
  notice: AntigravityRefusalNotice;
  /**
   * Writes the allow rule into the user's Antigravity project record and
   * re-runs the refused prompt. Absent while the session is busy, which hides
   * the buttons rather than offering a re-run that would only be queued.
   */
  onAllowAndRerun?: (input: {
    rule: string;
    prompt: string;
    projectPath: string;
  }) => Promise<AntigravityGrantOutcome>;
};

/**
 * Rendered by chat's MessageComponent under an Antigravity error row that
 * carries refused actions.
 *
 * Headless `agy` has no mid-turn permission prompt: a tool needing permission
 * is auto-denied and the turn still reports success, so this is the only place
 * the user learns what was refused. Allowing a rule writes it into the
 * Antigravity project record covering this Project — the same record the
 * Antigravity IDE writes — and then sends the same prompt again as a new turn.
 * The refused turn is left in place: `agy` has no rewind (ADR 0014), and the
 * refused-then-allowed pair is the more readable transcript anyway.
 */
function AntigravityPermissionNotice({ notice, onAllowAndRerun }: AntigravityPermissionNoticeProps) {
  const { t } = useTranslation('chat');
  const [pendingRule, setPendingRule] = useState<string | null>(null);
  const [allowedRules, setAllowedRules] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const handleAllow = async (rule: string) => {
    if (!onAllowAndRerun || pendingRule) return;
    setPendingRule(rule);
    setFailure(null);
    try {
      const outcome = await onAllowAndRerun({
        rule,
        prompt: notice.prompt,
        projectPath: notice.projectPath,
      });
      if (outcome.success) {
        setAllowedRules((previous) => [...previous, rule]);
      } else {
        setFailure(outcome.error || t('antigravityPermissions.grantFailed', {
          defaultValue: 'The permission could not be granted.',
        }));
      }
    } finally {
      setPendingRule(null);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-orange-300/60 bg-orange-50/60 p-3 dark:border-orange-600/40 dark:bg-orange-900/10">
      <div className="flex items-center gap-2 text-xs font-medium text-orange-700 dark:text-orange-300">
        <ShieldAlert className="h-4 w-4 flex-shrink-0" aria-hidden />
        <span>
          {t('antigravityPermissions.title', {
            defaultValue: 'Allow these actions for this project and run the prompt again',
          })}
        </span>
      </div>

      <ul className="mt-2 space-y-2">
        {notice.actions.map((action, index) => {
          const isAllowed = Boolean(action.rule && allowedRules.includes(action.rule));
          return (
            <li key={`${action.action}-${action.rule ?? index}`} className="flex flex-wrap items-center gap-2">
              <code className="max-w-full break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {action.rule ?? action.displayName ?? action.action}
              </code>
              {action.rule ? (
                <button
                  type="button"
                  disabled={!onAllowAndRerun || isAllowed || pendingRule !== null}
                  onClick={() => void handleAllow(action.rule as string)}
                  className="rounded border border-orange-300/60 px-2 py-0.5 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-orange-600/40 dark:text-orange-300 dark:hover:bg-orange-900/25"
                >
                  {isAllowed
                    ? t('antigravityPermissions.allowed', { defaultValue: 'Allowed · re-running' })
                    : pendingRule === action.rule
                      ? t('antigravityPermissions.allowing', { defaultValue: 'Allowing…' })
                      : t('antigravityPermissions.allowAndRerun', { defaultValue: 'Allow and re-run' })}
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {/* Antigravity matches a rule against the whole command, path
                      or URL, so without it there is nothing that can be granted
                      in one click. */}
                  {t('antigravityPermissions.ruleUnknown', {
                    defaultValue: 'Antigravity did not report the whole action, so it has to be allowed in the Antigravity IDE.',
                  })}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {failure && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{failure}</p>
      )}
    </div>
  );
}

export default AntigravityPermissionNotice;
