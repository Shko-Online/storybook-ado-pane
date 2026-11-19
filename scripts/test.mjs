/*
   Copyright 2026 Shko Online LLC <sales@shko.online>

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
 */

// Runs the tests in test/ with Node's own test runner. The tests are TypeScript, like the
// code they test, so they are bundled first (build/test/). The task is tested as the agent
// runs it: the built task, started as a process.
import * as esbuild from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'build', 'test');

if (!fs.existsSync(path.join(root, 'build', 'tasks', 'PublishStorybook', 'index.js'))) {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
}

fs.rmSync(out, { recursive: true, force: true });
const tests = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.ts'));
await esbuild.build({
  entryPoints: tests.map((f) => path.join(root, 'test', f)),
  outdir: out,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  logLevel: 'warning',
  // jszip is CommonJS and asks for Node's built-in modules with require().
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

const result = spawnSync(process.execPath, ['--test', ...tests.map((f) => path.join(out, f.replace(/\.ts$/, '.mjs')))], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
