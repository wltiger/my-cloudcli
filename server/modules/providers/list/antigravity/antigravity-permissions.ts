/**
 * Antigravity permission grants — written into the user's own project record
 * ==========================================================================
 *
 * Headless `agy` cannot prompt, so pre-granting is the only lever, and a grant
 * is only ever scoped to one Antigravity project: `~/.gemini/config/projects/
 * <project-id>.json`. That record is shared with the Antigravity IDE and the
 * user's own terminal, which is exactly the point — a grant given in the IDE
 * applies to a run started here and vice versa (ADR 0015).
 *
 * Two things this module owns:
 *
 * - **Resolution.** A CloudCLI Project maps to the Antigravity project whose
 *   `folderUri` covers its path. Recomputed on every call and never persisted,
 *   so a record the user creates or re-points in the IDE is picked up on the
 *   next run. A record is created only when no existing one covers the path.
 * - **Granting.** Read-modify-write of that record's own grant list, leaving
 *   every other field untouched, through a temp file and an atomic rename, with
 *   an immediate re-read to prove the replacement landed and still parses.
 *   The IDE may be writing the same file: the worst outcome allowed here is a
 *   lost update, never a half-written record.
 *
 * Usage:
 *   const projectId = await resolveAntigravityProjectId(projectPath);
 *   await grantAntigravityAction(projectPath, 'command(npm run build)');
 */

import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AnyRecord } from '@/shared/types.js';
import {
  AppError,
  normalizeProjectPath,
  readJsonRecord,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/**
 * The action kinds `agy` scopes a grant to.
 *
 * Precedence between lists is `deny > ask > allow`; `write_file` on a path
 * implies `read_file`, and denying `read_file` denies `write_file`. CloudCLI
 * only ever appends to `allow`.
 *
 * Exported for the antigravity runtime, which builds its own unanchored scan
 * pattern from the same list — adding a kind stays a one-place edit.
 */
export const ANTIGRAVITY_ACTION_KINDS = [
  'read_file',
  'write_file',
  'read_url',
  'execute_url',
  'command',
  'unsandboxed',
  'mcp',
] as const;

/**
 * One well-formed allow rule: an action kind naming the whole thing it permits.
 *
 * Used by the runtime to recognize the rule `agy` names on stderr when it
 * refuses an action, and here to reject anything that is not a rule before it
 * reaches the user's record. Matching inside `agy` is exact — `command(echo)`
 * does not cover `echo hello` — so the argument is the complete command, path
 * or URL, never a prefix.
 *
 * Exported for the antigravity runtime, which scans refusal output with it.
 */
export const ANTIGRAVITY_GRANT_RULE_PATTERN = new RegExp(
  `^(${ANTIGRAVITY_ACTION_KINDS.join('|')})\\(([^)]+)\\)$`,
);

/** Where `agy` and the Antigravity IDE keep their shared project records. */
const getProjectRecordsDir = (): string => (
  path.join(os.homedir(), '.gemini', 'config', 'projects')
);

const getProjectRecordPath = (projectId: string): string => (
  path.join(getProjectRecordsDir(), `${projectId}.json`)
);

/**
 * Converts a `folderUri` from a project record into a filesystem path.
 *
 * Both encodings these records carry are handled: `file:///C:/code/foo` and the
 * double-encoded `file:///c%253A/code/foo` the same directory is also written
 * as, which survives one `decodeURIComponent` as `%3A`. The drive letter is
 * lowercase on disk, which is why every comparison goes through
 * `normalizeProjectPath` rather than string equality.
 */
const folderUriToPath = (uri: string): string | null => {
  if (!uri.startsWith('file://')) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(uri.slice('file://'.length));
  } catch {
    return null;
  }

  const windowsPath = /^\/([A-Za-z])(?::|%3A)(\/.*)$/i.exec(decoded);
  if (windowsPath) {
    return `${windowsPath[1]}:${windowsPath[2]}`;
  }

  return decoded || null;
};

/**
 * Writes a filesystem path back out in the form these records store.
 *
 * Mirrors what the IDE writes: a percent-encoded `file://` URI whose Windows
 * drive letter is lowercase and whose colon is escaped (`file:///d%3A/code/foo`).
 */
const pathToFolderUri = (absolutePath: string): string => {
  const slashed = absolutePath.replace(/\\/g, '/');
  const encodeSegments = (value: string): string =>
    value.split('/').map((segment) => encodeURIComponent(segment)).join('/');

  const windowsPath = /^([A-Za-z]):(\/.*)?$/.exec(slashed);
  if (windowsPath) {
    return `file:///${windowsPath[1].toLowerCase()}%3A${encodeSegments(windowsPath[2] ?? '/')}`;
  }

  return `file://${encodeSegments(slashed)}`;
};

/** One project record on disk, with its `folderUri`s already resolved to paths. */
type AntigravityProjectRecord = {
  id: string;
  raw: AnyRecord;
  /** Every folder the record covers, normalized for comparison. */
  folders: string[];
};

/** Both resource shapes in the wild: a bare `{folderUri}` and `{gitFolder: {folderUri}}`. */
const readResourceFolderUri = (entry: unknown): string | undefined => {
  const resource = readObjectRecord(entry);
  return readOptionalString(resource?.folderUri)
    ?? readOptionalString(readObjectRecord(resource?.gitFolder)?.folderUri);
};

const readRecordFolders = (raw: AnyRecord): string[] => {
  const resources = readObjectRecord(raw.projectResources)?.resources;
  if (!Array.isArray(resources)) {
    return [];
  }

  const folders: string[] = [];
  for (const entry of resources) {
    const uri = readResourceFolderUri(entry);
    const resolved = uri ? folderUriToPath(uri) : null;
    const normalized = resolved ? normalizeProjectPath(resolved) : '';
    if (normalized) {
      folders.push(normalized);
    }
  }

  return folders;
};

/**
 * Reads one record off disk. Returns `null` for anything unreadable or not
 * JSON — a record the IDE is mid-write, or a stray file — so one bad record
 * never stops resolution from finding a good one.
 */
const readProjectRecord = (projectId: string): AntigravityProjectRecord | null => {
  let content: string;
  try {
    content = fsSync.readFileSync(getProjectRecordPath(projectId), 'utf8');
  } catch {
    return null;
  }

  const raw = readJsonRecord(content);
  return raw ? { id: projectId, raw, folders: readRecordFolders(raw) } : null;
};

const listProjectRecords = (): AntigravityProjectRecord[] => {
  let entries: string[];
  try {
    entries = fsSync.readdirSync(getProjectRecordsDir());
  } catch {
    return [];
  }

  const records: AntigravityProjectRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const record = readProjectRecord(entry.slice(0, -'.json'.length));
    if (record) {
      records.push(record);
    }
  }

  return records;
};

/**
 * Whether a record's folder covers a path — the same folder, or an ancestor of
 * it. Both sides are already `normalizeProjectPath`ed, which case-folds Windows
 * drive letters and strips trailing separators, so this is a plain prefix test
 * on whole segments (a `/code/foo` folder never covers `/code/foobar`).
 */
const folderCoversPath = (folder: string, target: string): boolean => {
  if (!folder || !target) {
    return false;
  }
  if (folder === target) {
    return true;
  }

  // `normalizeProjectPath` keeps the trailing separator on a filesystem root
  // (`d:\`, `/`) and strips it everywhere else.
  const prefix = /[\\/]$/.test(folder) ? folder : `${folder}${path.sep}`;
  return target.startsWith(prefix);
};

/**
 * The record that covers a path, most specific first.
 *
 * With nested records (a repo root and a package inside it) the deepest folder
 * is the one the user means, and it is also the narrower permission scope.
 */
const findCoveringRecord = (projectPath: string): AntigravityProjectRecord | null => {
  const target = normalizeProjectPath(projectPath);
  if (!target) {
    return null;
  }

  let best: AntigravityProjectRecord | null = null;
  let bestLength = -1;
  for (const record of listProjectRecords()) {
    for (const folder of record.folders) {
      if (folderCoversPath(folder, target) && folder.length > bestLength) {
        best = record;
        bestLength = folder.length;
      }
    }
  }

  return best;
};

/**
 * Replaces a record in one step: a temp file in the same directory, then a
 * rename over the target. A concurrent reader sees either the old record or the
 * new one, never a partial write.
 */
const writeProjectRecordAtomically = async (
  projectId: string,
  record: AnyRecord,
): Promise<void> => {
  const filePath = getProjectRecordPath(projectId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

/**
 * Creates the record for a path no existing one covers.
 *
 * Deliberately minimal — `id`, a display `name`, and the one folder it covers.
 * Nothing is copied from another project's `settings`: an unrelated project's
 * file-access and auto-execution policies are not this project's to inherit.
 * The one thing mirrored from an existing record is which of the two resource
 * shapes the local install writes, so the new record reads back the same way.
 */
const createProjectRecord = async (projectPath: string): Promise<string> => {
  const absolutePath = path.resolve(projectPath);
  const projectId = crypto.randomUUID();
  const sample = listProjectRecords()[0];
  const sampleResource = readObjectRecord(
    readObjectRecord(sample?.raw.projectResources)?.resources?.[0],
  );
  const folderUri = pathToFolderUri(absolutePath);
  const resource = sampleResource && readObjectRecord(sampleResource.gitFolder)
    ? { gitFolder: { folderUri } }
    : { folderUri };

  await writeProjectRecordAtomically(projectId, {
    id: projectId,
    name: path.basename(absolutePath) || absolutePath,
    projectResources: { resources: [resource] },
    permissionGrants: { permissionGrants: { allow: [] } },
    isWorkspaceOnly: false,
  });

  return projectId;
};

/**
 * The Antigravity project a CloudCLI Project runs under, created if none covers
 * it.
 *
 * Used by the antigravity runtime for `--project` — which attributes the
 * conversation *and* is the only scope a permission grant applies in — and by
 * the grant route, so both always name the same record. Never cached: the
 * answer is whatever the records say at the moment of the call.
 */
export const resolveAntigravityProjectId = async (projectPath: string): Promise<string> => {
  const covering = findCoveringRecord(projectPath);
  if (covering) {
    return covering.id;
  }

  return createProjectRecord(projectPath);
};

/** What the grant route reports back to the client. */
export type AntigravityGrantResult = {
  projectId: string;
  rule: string;
  /** The rule was already in the record; nothing was written. */
  alreadyAllowed: boolean;
};

const readAllowList = (raw: AnyRecord): string[] => {
  const inner = readObjectRecord(readObjectRecord(raw.permissionGrants)?.permissionGrants);
  const allow = inner?.allow;
  return Array.isArray(allow) ? allow.filter((entry): entry is string => typeof entry === 'string') : [];
};

/**
 * Adds one allow rule to the project record covering a path.
 *
 * Called by the providers route behind the one-click allow button. The record
 * is re-read immediately before the change (so a grant the IDE wrote a moment
 * ago survives), replaced atomically, then re-read again to prove the new rule
 * is there and the file still parses. If a concurrent writer replaced the file
 * in between, that re-read fails and the caller is told the grant was lost
 * rather than being left to believe it took.
 */
export const grantAntigravityAction = async (
  projectPath: string,
  rule: string,
): Promise<AntigravityGrantResult> => {
  const normalizedRule = rule.trim();
  if (!ANTIGRAVITY_GRANT_RULE_PATTERN.test(normalizedRule)) {
    throw new AppError(
      `"${normalizedRule}" is not an Antigravity permission rule. Expected one of ${ANTIGRAVITY_ACTION_KINDS.join(', ')} naming the whole action, e.g. command(npm run build).`,
      { code: 'ANTIGRAVITY_INVALID_GRANT_RULE', statusCode: 400 },
    );
  }

  const projectId = await resolveAntigravityProjectId(projectPath);
  const record = readProjectRecord(projectId);
  if (!record) {
    throw new AppError(
      `Antigravity project record "${projectId}" could not be read.`,
      { code: 'ANTIGRAVITY_PROJECT_RECORD_UNREADABLE', statusCode: 500 },
    );
  }

  const allow = readAllowList(record.raw);
  if (allow.includes(normalizedRule)) {
    return { projectId, rule: normalizedRule, alreadyAllowed: true };
  }

  // Every field outside the allow list is carried over verbatim, at both
  // levels of the record's own `permissionGrants.permissionGrants` nesting.
  const outerGrants = readObjectRecord(record.raw.permissionGrants) ?? {};
  const innerGrants = readObjectRecord(outerGrants.permissionGrants) ?? {};
  await writeProjectRecordAtomically(projectId, {
    ...record.raw,
    permissionGrants: {
      ...outerGrants,
      permissionGrants: { ...innerGrants, allow: [...allow, normalizedRule] },
    },
  });

  const written = readProjectRecord(projectId);
  if (!written || !readAllowList(written.raw).includes(normalizedRule)) {
    throw new AppError(
      `The grant for "${normalizedRule}" was overwritten by another writer (the Antigravity IDE or a terminal) before it could be confirmed. Try again.`,
      { code: 'ANTIGRAVITY_GRANT_LOST', statusCode: 409 },
    );
  }

  return { projectId, rule: normalizedRule, alreadyAllowed: false };
};
