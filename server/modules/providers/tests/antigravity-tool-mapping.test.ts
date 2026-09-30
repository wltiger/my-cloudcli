/**
 * Antigravity tool mapping — the pure fold from `agy`'s names and stored
 * arguments onto the canonical shape the frontend renders.
 *
 * Driven by a shared fixture copied from real `transcript.jsonl` arguments, so
 * the shape asserted here is the shape the registry will actually read. Nothing
 * here touches a filesystem: the mapping is a pure function and the fixture is
 * the whole contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isAntigravityBackgroundResult,
  mapAntigravityTool,
  parseAgyQuestionAnswers,
  readAgySubagentConversationIds,
  readAgySubagentSpecs,
  readAgyTaskName,
} from '@/modules/providers/list/antigravity/antigravity-tool-mapping.js';

type MappingCase = {
  agyName: string;
  args: Record<string, unknown>;
  resultContent: string | null;
  expected: { toolName: string; input: Record<string, unknown> };
};

const FIXTURE = JSON.parse(await fs.readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'antigravity-tool-mapping.json'),
  'utf8',
)) as { cases: MappingCase[] };

test('every agy tool folds onto the canonical name the transcript renders', () => {
  for (const testCase of FIXTURE.cases) {
    const mapped = mapAntigravityTool(testCase.agyName, testCase.args, testCase.resultContent);
    assert.equal(
      mapped.toolName,
      testCase.expected.toolName,
      `${testCase.agyName} must map to ${testCase.expected.toolName}`,
    );
  }
});

test('the mapped input carries every key the registry reads, with a non-empty value', () => {
  // A rename nobody reads is the failure this catches: the backend seam cannot
  // see the registry, so the fixture names the keys that must survive.
  for (const testCase of FIXTURE.cases) {
    const mapped = mapAntigravityTool(testCase.agyName, testCase.args, testCase.resultContent);
    for (const key of Object.keys(testCase.expected.input)) {
      const value = mapped.input[key];
      assert.notEqual(value, undefined, `${testCase.agyName} must carry ${key}`);
      if (typeof value === 'string') {
        assert.ok(value.length > 0, `${testCase.agyName}.${key} must not be empty`);
      }
    }
  }
});

test('a content argument that happens to be valid JSON stays a string', () => {
  // Blanket-decoding every argument would turn a written package.json into an
  // object, and the diff builder splits `content` by line — empty diff, or a
  // throw.
  const mapped = mapAntigravityTool('write_to_file', {
    CodeContent: '{\n  "name": "x"\n}',
    TargetFile: '"a/package.json"',
  });
  assert.equal(typeof mapped.input.content, 'string');
  assert.equal(mapped.input.content, '{\n  "name": "x"\n}');

  for (const body of ['[1,2,3]', '12345', 'true']) {
    const other = mapAntigravityTool('write_to_file', { CodeContent: body, TargetFile: '"f"' });
    assert.equal(typeof other.input.content, 'string', `body ${body} must stay a string`);
  }

  // An ordinary diff tool reads the same way.
  const edit = mapAntigravityTool('replace_file_content', {
    TargetContent: '{"a":1}',
    ReplacementContent: '[1]',
    TargetFile: '"f"',
  });
  assert.equal(typeof edit.input.old_string, 'string');
  assert.equal(typeof edit.input.new_string, 'string');
});

test('a boolean argument decodes so "false" is not truthy', () => {
  // Every real record stores IsDaemon as the string "false". Decoded, `=== true`
  // never matches; truthiness would mark every command as background.
  const foreground = mapAntigravityTool('run_command', { CommandLine: '"x"', IsDaemon: '"false"' });
  assert.equal(foreground.input.description, undefined);

  const daemon = mapAntigravityTool('run_command', { CommandLine: '"x"', IsDaemon: '"true"' });
  assert.match(String(daemon.input.description), /^\[background/);
});

test('a command that timed out into the background is marked, not just a declared daemon', () => {
  // 46 of 193 run_command calls in the reference session went to the background
  // by exceeding the wait timeout; only 6 declared IsDaemon.
  const result = 'Tool is running as a background task with task id: conv-1/task-72';
  assert.equal(isAntigravityBackgroundResult(result), true);
  assert.equal(isAntigravityBackgroundResult('build ok'), false);

  const mapped = mapAntigravityTool(
    'run_command',
    { CommandLine: '"dotnet run"', IsDaemon: '"false"', toolSummary: '"Start server"' },
    result,
  );
  assert.equal(mapped.input.description, '[background · task-72] Start server');
});

test('manage_task without a task id renders rather than throwing', () => {
  // The `list` action carries none; a naive split on it would throw and the
  // reader's catch would empty the whole conversation's history.
  const mapped = mapAntigravityTool('manage_task', { Action: '"list"' });
  assert.deepEqual(mapped.input, { taskName: 'all tasks', action: 'list' });

  assert.equal(readAgyTaskName('conv-1/task-72'), 'task-72');
  assert.equal(readAgyTaskName(undefined), '');
});

test('a user-facing artifact renders as a document card, whatever form its metadata arrives in', () => {
  const encoded = mapAntigravityTool('write_to_file', {
    ArtifactMetadata: '{"UserFacing":true,"Summary":"The report"}',
    CodeContent: '# Report',
    TargetFile: '"r.md"',
  });
  assert.equal(encoded.toolName, 'AgyArtifactDoc');
  assert.equal(encoded.input.artifactTitle, 'The report');

  const decoded = mapAntigravityTool('write_to_file', {
    ArtifactMetadata: { UserFacing: true, Summary: 'The report' },
    CodeContent: '# Report',
    TargetFile: '"r.md"',
  });
  assert.equal(decoded.toolName, 'AgyArtifactDoc');

  const notUserFacing = mapAntigravityTool('write_to_file', {
    ArtifactMetadata: '{"UserFacing":false,"Summary":"x"}',
    CodeContent: '# Report',
    TargetFile: '"r.md"',
  });
  assert.equal(notUserFacing.toolName, 'Write');
});

test('both path separators normalize to one, so diff-card titles split correctly', () => {
  const mapped = mapAntigravityTool('view_file', { AbsolutePath: '"C:\\\\Users\\\\docs\\\\a.md"' });
  assert.equal(mapped.input.file_path, 'C:/Users/docs/a.md');
});

test('an unknown tool passes through with its real name', () => {
  const mapped = mapAntigravityTool('mystery_new_tool', { Target: '"x"' });
  assert.equal(mapped.toolName, 'mystery_new_tool');
  assert.equal(mapped.input.Target, 'x');
});

test('a tool named with different casing still maps', () => {
  assert.equal(mapAntigravityTool('RunCommand', { CommandLine: '"x"' }).toolName, 'Bash');
  assert.equal(mapAntigravityTool('run_command', { CommandLine: '"x"' }).toolName, 'Bash');
});

test('subagent specs and announced ids are read in the same order', () => {
  const specs = readAgySubagentSpecs({
    Subagents: '[{"Prompt":"look","Role":"Researcher","TypeName":"research"},{"Prompt":"write","Role":"Writer"}]',
  });
  assert.deepEqual(specs.map((spec) => spec.role), ['Researcher', 'Writer']);
  assert.equal(specs[1]?.typeName, '');

  const ids = readAgySubagentConversationIds(
    'Created the following subagents:\n{"conversationId":  "551498c1-e220-451b-9538-42d5a221dc0d"}',
  );
  assert.deepEqual(ids, ['551498c1-e220-451b-9538-42d5a221dc0d']);

  // A call with no agents still yields one container rather than vanishing.
  assert.equal(readAgySubagentSpecs({}).length, 1);
});

test('ask_question answers fold in keyed by the question text, including a skip', () => {
  const mapped = mapAntigravityTool('ask_question', {
    questions: '[{ "question": "Which mode?", "options": ["headless"], "is_multi_select": false }]',
  });
  const questions = mapped.input.questions as Record<string, unknown>[];
  assert.equal(questions.length, 1);
  assert.deepEqual(
    (questions[0] as { options: unknown[] }).options,
    [{ label: 'headless' }],
  );

  const answers = parseAgyQuestionAnswers(questions, 'A1: User Skipped');
  assert.deepEqual(answers, { 'Which mode?': 'User Skipped' });
});
