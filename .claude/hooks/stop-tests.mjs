// Claude Code Stop hook: run the test suite before Claude finishes a turn. If tests fail, exit 2 so
// Claude keeps working with the failures in front of it. A stop that follows one this hook already
// blocked (stop_hook_active) is let through, so it can never loop.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
if (input.stop_hook_active) process.exit(0);

const root = fileURLToPath(new URL('../..', import.meta.url));
const cmd = process.env.STOP_TEST_CMD || 'npm test --silent';
try {
  execSync(cmd, { cwd: root, stdio: 'pipe', encoding: 'utf8', timeout: 120_000 });
  process.exit(0);
} catch (e) {
  const out = `${e.stdout || ''}\n${e.stderr || ''}`;
  const failures = out.split('\n').filter((l) => /^\s*not ok|AssertionError|Error:/.test(l)).slice(0, 15);
  process.stderr.write(`Tests are failing (${cmd}). Fix them before finishing, or say plainly why not:\n${failures.join('\n') || out.slice(-1500)}\n`);
  process.exit(2);
}
