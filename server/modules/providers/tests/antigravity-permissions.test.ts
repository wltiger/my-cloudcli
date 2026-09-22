/**
 * Antigravity project resolution and permission grants, against real records
 * under a temporary home.
 *
 * `~/.gemini/config/projects/<id>.json` is a file the Antigravity IDE also owns,
 * so these tests pin the two things that matter to a user: the grant lands in
 * the record that actually covers their folder, and nothing else in that record
 * changes. No mocks, no process, no network.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  grantAntigravityAction,
  resolveAntigravityProjectId,
} from '@/modules/providers/list/antigravity/antigravity-permissions.js';
import { AppError } from '@/shared/utils.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

type ProjectRecords = Record<string, Record<string, unknown> | string>;

/** A record in the shape the IDE writes, covering one folder. */
const recordFor = (id: string, folderUri: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  projectResources: { resources: [{ folderUri }] },
  permissionGrants: { permissionGrants: { allow: [] } },
  isWorkspaceOnly: false,
  ...extra,
});

async function withProjectRecords(
  records: ProjectRecords,
  run: (context: {
    recordsDir: string;
    readRecord: (id: string) => Promise<Record<string, unknown>>;
    listFiles: () => Promise<string[]>;
  }) => Promise<void>,
): Promise<void> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-permissions-'));
  const restoreHomeDir = patchHomeDir(homeDir);
  try {
    const recordsDir = path.join(homeDir, '.gemini', 'config', 'projects');
    await fs.mkdir(recordsDir, { recursive: true });
    for (const [id, content] of Object.entries(records)) {
      await fs.writeFile(
        path.join(recordsDir, `${id}.json`),
        typeof content === 'string' ? content : JSON.stringify(content, null, 2),
        'utf8',
      );
    }

    await run({
      recordsDir,
      readRecord: async (id) => JSON.parse(await fs.readFile(path.join(recordsDir, `${id}.json`), 'utf8')),
      listFiles: () => fs.readdir(recordsDir),
    });
  } finally {
    restoreHomeDir();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Resolution — a grant only applies in the project the run is attributed to
// ---------------------------------------------------------------------------

test('the same folder resolves to one record however the path is spelled', async () => {
  // Drive-letter case, separator and a trailing slash all vary between the
  // places a project path reaches this code from.
  await withProjectRecords({
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async () => {
    for (const spelling of ['D:/code/demo', 'd:\\code\\demo', 'D:\\Code\\..\\code\\demo', 'd:/code/demo/']) {
      assert.equal(await resolveAntigravityProjectId(spelling), 'ide-owned', `failed for ${spelling}`);
    }
  });
});

test('a folder inside the project resolves to the project that covers it', async () => {
  await withProjectRecords({
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async () => {
    assert.equal(await resolveAntigravityProjectId('D:/code/demo/packages/api'), 'ide-owned');
  });
});

test('a sibling whose name merely starts the same is not covered', async () => {
  // A plain string prefix would file `…/demo-extra` under the `…/demo` record
  // and quietly grant it that project's permissions.
  await withProjectRecords({
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async ({ listFiles }) => {
    const resolved = await resolveAntigravityProjectId('D:/code/demo-extra');

    assert.notEqual(resolved, 'ide-owned');
    assert.equal((await listFiles()).length, 2, 'the uncovered folder gets its own record');
  });
});

test('the deepest record wins when two cover the same folder', async () => {
  // A package record inside a repo record is both what the user means and the
  // narrower permission scope.
  await withProjectRecords({
    repo: recordFor('repo', 'file:///d%3A/code/demo'),
    pkg: recordFor('pkg', 'file:///d%3A/code/demo/packages/api'),
  }, async () => {
    assert.equal(await resolveAntigravityProjectId('D:/code/demo/packages/api/src'), 'pkg');
    assert.equal(await resolveAntigravityProjectId('D:/code/demo/packages/web'), 'repo');
  });
});

test('the double-encoded folderUri agy also writes resolves the same way', async () => {
  // The drive colon survives one `decodeURIComponent` as `%3A`; ordinary
  // segments stay singly encoded.
  await withProjectRecords({
    'double-encoded': recordFor('double-encoded', 'file:///c%253A/tmp/agy%20demo'),
  }, async () => {
    assert.equal(await resolveAntigravityProjectId('C:/tmp/agy demo/pkg'), 'double-encoded');
  });
});

test('the git-aware resource shape resolves like the bare one', async () => {
  await withProjectRecords({
    'git-shaped': {
      id: 'git-shaped',
      projectResources: { resources: [{ gitFolder: { folderUri: 'file:///d%3A/code/demo' } }] },
    },
  }, async () => {
    assert.equal(await resolveAntigravityProjectId('D:/code/demo'), 'git-shaped');
  });
});

test('a record the IDE is mid-write on never blocks the others', async () => {
  await withProjectRecords({
    broken: '{not json',
    empty: '',
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async () => {
    assert.equal(await resolveAntigravityProjectId('D:/code/demo'), 'ide-owned');
  });
});

test('a folder no record covers gets one record, reused from then on', async () => {
  await withProjectRecords({}, async ({ readRecord, listFiles }) => {
    const created = await resolveAntigravityProjectId(path.join('C:', 'tmp', 'agy smoke'));
    const again = await resolveAntigravityProjectId(path.join('C:', 'tmp', 'agy smoke'));

    assert.equal(again, created, 'a second run must not create a second record');
    assert.deepEqual(await listFiles(), [`${created}.json`]);

    const record = await readRecord(created);
    assert.equal(record.name, 'agy smoke');
    // Written back in the IDE's own form: lowercase drive letter, escaped
    // colon, percent-encoded segments.
    assert.deepEqual(record.projectResources, {
      resources: [{ folderUri: 'file:///c%3A/tmp/agy%20smoke' }],
    });
    assert.deepEqual(record.permissionGrants, { permissionGrants: { allow: [] } });
    assert.equal(record.isWorkspaceOnly, false);
  });
});

test('a new record inherits no other project\'s policy settings', async () => {
  // `fileAccessPolicy`, `sandboxMode` and `autoExecutionPolicy` are
  // permission-adjacent: inheriting an unrelated project's is silent widening.
  await withProjectRecords({
    other: recordFor('other', 'file:///d%3A/elsewhere', {
      settings: { fileAccessPolicy: 'ALLOW_ALL', sandboxMode: false },
    }),
  }, async ({ readRecord }) => {
    const created = await resolveAntigravityProjectId('D:/code/fresh');
    assert.equal((await readRecord(created)).settings, undefined);
  });
});

test('a new record mirrors which resource shape the local install writes', async () => {
  await withProjectRecords({
    'git-shaped': {
      id: 'git-shaped',
      projectResources: { resources: [{ gitFolder: { folderUri: 'file:///d%3A/elsewhere' } }] },
    },
  }, async ({ readRecord }) => {
    const created = await resolveAntigravityProjectId('D:/code/fresh');
    const resources = (await readRecord(created)).projectResources as { resources: unknown[] };

    assert.deepEqual(resources.resources, [{ gitFolder: { folderUri: 'file:///d%3A/code/fresh' } }]);
  });
});

// ---------------------------------------------------------------------------
// Rule validation — a malformed rule must never reach the user's record
// ---------------------------------------------------------------------------

test('a bare command is not a rule', async () => {
  await withProjectRecords({
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async ({ readRecord }) => {
    await assert.rejects(
      () => grantAntigravityAction('D:/code/demo', 'npm run build'),
      (error: unknown) => error instanceof AppError
        && error.code === 'ANTIGRAVITY_INVALID_GRANT_RULE'
        && error.statusCode === 400,
    );

    const record = await readRecord('ide-owned');
    assert.deepEqual(record.permissionGrants, { permissionGrants: { allow: [] } });
  });
});

test('a wildcard or partial rule is rejected — matching in agy is exact', async () => {
  await withProjectRecords({
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async ({ listFiles }) => {
    for (const rule of [
      'Bash(npm:*)',            // a Claude permission rule, not an Antigravity one
      'command()',              // names no action
      'commandx(npm)',          // not one of the seven kinds
      'command(npm) extra',     // trailing text
      'run_command(npm build)', // tool name, not an action kind
      '',
    ]) {
      await assert.rejects(
        () => grantAntigravityAction('D:/code/demo', rule),
        (error: unknown) => error instanceof AppError && error.statusCode === 400,
        `rule ${JSON.stringify(rule)} must be rejected`,
      );
    }

    assert.deepEqual(await listFiles(), ['ide-owned.json'], 'a rejected rule writes nothing at all');
  });
});

test('every action kind agy scopes a grant to is accepted', async () => {
  await withProjectRecords({
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async ({ readRecord }) => {
    const rules = [
      'read_file(d:/code/demo/README.md)',
      'write_file(d:/code/demo/README.md)',
      'read_url(example.com)',
      'execute_url(example.com/run)',
      'command(npm run build)',
      'unsandboxed(npm run build)',
      'mcp(playwright)',
    ];
    for (const rule of rules) {
      assert.equal((await grantAntigravityAction('D:/code/demo', rule)).alreadyAllowed, false);
    }

    const grants = (await readRecord('ide-owned')).permissionGrants as {
      permissionGrants: { allow: string[] };
    };
    assert.deepEqual(grants.permissionGrants.allow, rules);
  });
});

// ---------------------------------------------------------------------------
// Grant writing — read, modify, write, and prove it took
// ---------------------------------------------------------------------------

test('a grant appends to the record the IDE already wrote, leaving the rest verbatim', async () => {
  await withProjectRecords({
    'ide-owned': {
      id: 'ide-owned',
      name: 'Demo',
      projectResources: { resources: [{ folderUri: 'file:///d%3A/code/demo' }] },
      permissionGrants: {
        version: 3,
        permissionGrants: {
          allow: ['command(git status)'],
          deny: ['command(rm -rf /)'],
          ask: ['read_url(internal.example.com)'],
        },
      },
      settings: { fileAccessPolicy: 'ASK', sandboxMode: false, autoExecutionPolicy: 'OFF' },
      isWorkspaceOnly: true,
      someFutureKey: { kept: true },
    },
  }, async ({ readRecord }) => {
    const result = await grantAntigravityAction('D:/code/demo/packages/api', 'command(npm run build)');

    assert.deepEqual(result, {
      projectId: 'ide-owned',
      rule: 'command(npm run build)',
      alreadyAllowed: false,
    });

    const record = await readRecord('ide-owned');
    assert.deepEqual(record.permissionGrants, {
      version: 3,
      permissionGrants: {
        allow: ['command(git status)', 'command(npm run build)'],
        deny: ['command(rm -rf /)'],
        ask: ['read_url(internal.example.com)'],
      },
    });
    assert.deepEqual(record.settings, { fileAccessPolicy: 'ASK', sandboxMode: false, autoExecutionPolicy: 'OFF' });
    assert.equal(record.isWorkspaceOnly, true);
    assert.deepEqual(record.someFutureKey, { kept: true });
    assert.equal(record.name, 'Demo');
  });
});

test('granting the same rule twice reports it and writes nothing', async () => {
  await withProjectRecords({
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async ({ recordsDir, readRecord }) => {
    await grantAntigravityAction('D:/code/demo', 'command(npm run build)');
    const afterFirst = await fs.readFile(path.join(recordsDir, 'ide-owned.json'), 'utf8');

    const second = await grantAntigravityAction('D:/code/demo', '  command(npm run build)  ');

    assert.equal(second.alreadyAllowed, true);
    assert.equal(
      await fs.readFile(path.join(recordsDir, 'ide-owned.json'), 'utf8'),
      afterFirst,
      'an already-granted rule must not rewrite the file the IDE shares',
    );
    const grants = (await readRecord('ide-owned')).permissionGrants as {
      permissionGrants: { allow: string[] };
    };
    assert.deepEqual(grants.permissionGrants.allow, ['command(npm run build)']);
  });
});

test('a narrower and a broader command are independent rules', async () => {
  // `command(npm)` does not cover `npm run build` — matching is exact, which is
  // the whole reason the one-click-from-a-denial loop exists.
  await withProjectRecords({
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async ({ readRecord }) => {
    await grantAntigravityAction('D:/code/demo', 'command(npm)');
    const second = await grantAntigravityAction('D:/code/demo', 'command(npm run build)');

    assert.equal(second.alreadyAllowed, false);
    const grants = (await readRecord('ide-owned')).permissionGrants as {
      permissionGrants: { allow: string[] };
    };
    assert.deepEqual(grants.permissionGrants.allow, ['command(npm)', 'command(npm run build)']);
  });
});

test('a record with no permissionGrants block at all gains one', async () => {
  await withProjectRecords({
    minimal: {
      id: 'minimal',
      projectResources: { resources: [{ folderUri: 'file:///d%3A/code/demo' }] },
    },
  }, async ({ readRecord }) => {
    await grantAntigravityAction('D:/code/demo', 'read_url(example.com)');

    assert.deepEqual((await readRecord('minimal')).permissionGrants, {
      permissionGrants: { allow: ['read_url(example.com)'] },
    });
  });
});

test('granting for an uncovered folder creates its record and grants there', async () => {
  await withProjectRecords({}, async ({ readRecord, listFiles }) => {
    const result = await grantAntigravityAction('C:/tmp/agy smoke', 'read_url(example.com)');

    assert.equal(result.alreadyAllowed, false);
    assert.deepEqual(await listFiles(), [`${result.projectId}.json`]);
    const grants = (await readRecord(result.projectId)).permissionGrants as {
      permissionGrants: { allow: string[] };
    };
    assert.deepEqual(grants.permissionGrants.allow, ['read_url(example.com)']);
  });
});

test('no temp file survives a write, successful or rejected', async () => {
  // The record is replaced by renaming a temp file over it; a leftover `.tmp`
  // in the shared directory would be litter in a folder the IDE scans.
  await withProjectRecords({
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async ({ listFiles }) => {
    await grantAntigravityAction('D:/code/demo', 'command(npm run build)');
    await assert.rejects(() => grantAntigravityAction('D:/code/demo', 'nonsense'));

    assert.deepEqual((await listFiles()).filter((name) => name.endsWith('.tmp')), []);
  });
});

test('the written record is valid JSON another reader can parse', async () => {
  await withProjectRecords({
    'ide-owned': recordFor('ide-owned', 'file:///d%3A/code/demo'),
  }, async ({ recordsDir }) => {
    await grantAntigravityAction('D:/code/demo', 'command(npm run build)');
    const raw = await fs.readFile(path.join(recordsDir, 'ide-owned.json'), 'utf8');

    assert.doesNotThrow(() => JSON.parse(raw));
    assert.ok(raw.endsWith('\n'), 'the IDE writes newline-terminated records');
  });
});
