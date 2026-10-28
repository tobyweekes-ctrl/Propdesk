// The Claude Code Stop hook (.claude/hooks/stop-tests.mjs): blocks finishing while tests fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../.claude/hooks/stop-tests.mjs', import.meta.url));
const run = (input, cmd) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, STOP_TEST_CMD: cmd },
});

test('passing tests let Claude finish', () => {
  assert.equal(run({ stop_hook_active: false }, 'true').status, 0);
});

test('failing tests block finishing (exit 2) and say why on stderr', () => {
  const r = run({ stop_hook_active: false }, 'echo "not ok 3 - parses prices" && false');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Tests are failing/);
  assert.match(r.stderr, /not ok 3 - parses prices/);
});

test('a second stop in a row is never blocked (no loop)', () => {
  assert.equal(run({ stop_hook_active: true }, 'false').status, 0);
});

test('unreadable input does not block', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, STOP_TEST_CMD: 'false' } });
  assert.equal(r.status, 0);
});
