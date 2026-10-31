// Runs every scripts/test-*.py as its own process (the file names contain dashes, so unittest
// discovery cannot import them). Uses APEX_PYTHON, then the project's .venv, then python on PATH.
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.APEX_PYTHON || (existsSync(venv) ? venv : 'python');
const files = readdirSync(path.join(root, 'scripts')).filter(name => /^test-.*\.py$/.test(name)).sort();
const failed = [];
for (const file of files) {
  console.log(`\n# ${file}`);
  const run = spawnSync(python, [path.join('scripts', file)], {cwd: root, stdio: 'inherit'});
  if (run.status !== 0) failed.push(file);
}
console.log(failed.length ? `\nFailed: ${failed.join(', ')}` : `\nAll ${files.length} Python test files passed.`);
process.exit(failed.length ? 1 : 0);
