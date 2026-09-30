import type { ToolDisplayConfig } from '@/modules/chat/tools/configs/toolConfigs';

/**
 * Display configs for the tools only Antigravity has.
 *
 * The backend folds every `agy` tool it can onto a canonical Claude tool
 * (server/modules/providers/list/antigravity/antigravity-tool-mapping.ts). These
 * are the ones with no Claude counterpart, renamed to names this registry keys
 * on; the mapping's shared fixture lists the input keys each one must read.
 *
 * The one-line cards take their colour from `colorScheme`, so the task-shaped
 * tools join the violet task family and the image tool the sky web family
 * without a category of their own.
 *
 * Merged into TOOL_CONFIGS by toolConfigs.ts.
 */
export const ANTIGRAVITY_TOOL_CONFIGS: Record<string, ToolDisplayConfig> = {
  // manage_task — checks on, lists or stops a background command.
  AgyTask: {
    input: {
      type: 'one-line',
      label: 'Task',
      getValue: (input) => input.taskName || '',
      getSecondary: (input) => input.action,
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      type: 'collapsible',
      title: 'Output',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({ content: String(result?.content || ''), format: 'plain' })
    }
  },

  // schedule — a timer or cron that prompts the agent again later.
  AgySchedule: {
    input: {
      type: 'one-line',
      label: 'Schedule',
      getValue: (input) => input.prompt || '',
      getSecondary: (input) => input.label,
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      hideOnSuccess: true
    }
  },

  // manage_subagents — checks on the agents this conversation spawned.
  AgySubagents: {
    input: {
      type: 'one-line',
      label: 'Subagents',
      getValue: (input) => input.action || '',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      type: 'collapsible',
      title: 'Output',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({ content: String(result?.content || ''), format: 'plain' })
    }
  },

  // send_message — to another conversation, named by its id's head the way
  // notices name it.
  AgyMessage: {
    input: {
      type: 'one-line',
      label: 'Message',
      getValue: (input) => (input.recipient ? `to ${input.recipient}` : ''),
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      hideOnSuccess: true
    }
  },

  // generate_image — the picture itself shows as a thumbnail on the row.
  AgyImage: {
    input: {
      type: 'one-line',
      label: 'Image',
      getValue: (input) => input.prompt || '',
      getSecondary: (input) => input.name,
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-sky-400 dark:border-sky-500',
        icon: 'text-sky-500 dark:text-sky-400'
      }
    },
    result: {
      hideOnSuccess: true
    }
  },

  // A user-facing artifact `write_to_file` wrote: the document it is, not a
  // diff of a new file.
  AgyArtifactDoc: {
    input: {
      type: 'collapsible',
      title: (input) => input.artifactTitle || 'Document',
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (input) => ({ content: input.content || '' })
    },
    result: {
      hideOnSuccess: true
    }
  }
};
