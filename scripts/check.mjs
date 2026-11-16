// One command for checking the site, in two sizes.
//
//   npm run check:quick [-- e2e/season-layout.spec.mjs ...]
//     After each change (about a minute): build once, unit tests and lint (cached) together, then only the browser test
//     files named, if any.
//   npm run check:full
//     Before a push (about 6-8 minutes instead of 12-14): build once; unit tests, lint and (only when a .py file changed)
//     the Python tests together; the four audits two at a time (each serves the build on its own port); then every
//     browser test. The audits run before the browser tests because Playwright rebuilds the site and clears
//     test-results/ when it starts.
//
// Workers: APEX_CHECK_WORKERS (default: cores - 1, at least 2). Exit code is non-zero when anything failed; a summary of
// every step and how long it took is printed at the end.
import {spawn, execSync} from 'node:child_process';
import os from 'node:os';

const mode = process.argv[2] === '--full' ? 'full' : 'quick';
const specs = process.argv.slice(3).filter(a => a.endsWith('.mjs'));
const workers = Number(process.env.APEX_CHECK_WORKERS) || Math.max(2, os.cpus().length - 1);
const results = [];

function run(name, command, args) {
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn(command, args, {shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      const seconds = ((Date.now() - started) / 1000).toFixed(0);
      results.push({name, ok: code === 0, seconds});
      const tail = out.trim().split(/\r?\n/).slice(code === 0 ? -1 : -25).join('\n');
      console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${name} (${seconds}s)\n${tail.replace(/^/gm, '     ')}`);
      resolve(code === 0);
    });
  });
}
// Run tasks with at most `limit` at once.
async function pool(tasks, limit) {
  const queue = [...tasks];
  await Promise.all(Array.from({length: Math.min(limit, queue.length)}, async () => { while (queue.length) await queue.shift()(); }));
}
const pythonChanged = () => {
  try {
    const changed = execSync('git diff --name-only HEAD && git diff --name-only @{upstream}...HEAD', {encoding: 'utf8'});
    return /\.py$/m.test(changed);
  } catch { return true; }
};

const started = Date.now();
await run('build', 'node', ['scripts/sync-static.mjs']);
const basics = [() => run('unit tests', 'node', ['--test']), () => run('lint', 'npx', ['eslint', '.', '--cache', '--cache-location', '.apex-cache/eslint'])];
if (mode === 'full' && pythonChanged()) basics.push(() => run('python tests', 'node', ['scripts/run-python-tests.mjs']));
await pool(basics, basics.length);
if (mode === 'full') {
  await pool(['linear', 'charts', 'a11y', 'coverage'].map(a => () => run(`audit ${a}`, 'node', [`scripts/audit-${a}.mjs`, '--browser', 'chromium'])), 2);
  await run('browser tests', 'npx', ['playwright', 'test', '--project=chromium', '--retries=0', `--workers=${workers}`]);
} else if (specs.length) {
  await run('browser tests (named)', 'npx', ['playwright', 'test', '--project=chromium', '--retries=0', `--workers=${workers}`, ...specs]);
}
const failed = results.filter(r => !r.ok);
console.log(`\n${mode} check: ${results.length - failed.length}/${results.length} passed in ${((Date.now() - started) / 1000).toFixed(0)}s${failed.length ? ' · failed: ' + failed.map(r => r.name).join(', ') : ''}`);
process.exitCode = failed.length ? 1 : 0;
