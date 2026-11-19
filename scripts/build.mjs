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

// Builds everything the .vsix needs into build/:
//   build/web/                    the build results tab (tab.html) and the new-tab page (viewer.html)
//   build/web/sb/                 the service worker that serves Storybooks from memory (sw.js) and
//                                 the script it adds to their pages (bridge.js)
//   build/tasks/PublishStorybook/ the pipeline task (bundled + production node_modules)
// `--dev` also emits the local harness (dev.html / host.html) with inline source maps.
// `--version x.y.z` stamps that version into the packaged task.json (used by releases).
// `--dev-task` gives the packaged task the identity of the private "-dev" extension
// (tasks/PublishStorybook/task.dev.json), so it can be installed next to the public one.
// `--web-only` builds just build/web/.
import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const webOnly = process.argv.includes('--web-only');
const devTask = process.argv.includes('--dev-task');
const versionArg = process.argv.indexOf('--version');
const version = versionArg > 0 ? process.argv[versionArg + 1] : undefined;
if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`--version must look like 1.2.3, got "${version}"`);
}
const out = path.join(root, 'build');
const web = path.join(out, 'web');
const taskSrc = path.join(root, 'tasks', 'PublishStorybook');
const taskOut = path.join(out, 'tasks', 'PublishStorybook');

fs.rmSync(webOnly ? web : out, { recursive: true, force: true });
fs.mkdirSync(path.join(web, 'sb'), { recursive: true });

const copy = (from, to) => fs.copyFileSync(path.join(root, from), to);

// --- build results tab -------------------------------------------------------
const browser = {
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: !dev || process.argv.includes('--minify'),
  sourcemap: dev ? 'inline' : false,
  legalComments: 'eof',
  logLevel: 'warning',
};
const bundle = (entry, outfile) =>
  esbuild.build({ ...browser, entryPoints: [path.join(root, entry)], outfile: path.join(web, outfile) });

await bundle('src/tab/main.ts', 'tab.js');
await bundle('src/tab/viewer.ts', 'viewer.js');
// The service worker's folder is its scope: it only handles requests below sb/.
await bundle('src/sw/sw.ts', 'sb/sw.js');
await bundle('src/viewer/bridge.ts', 'sb/bridge.js');
copy('src/tab/tab.html', path.join(web, 'tab.html'));
copy('src/tab/viewer.html', path.join(web, 'viewer.html'));
copy('src/tab/tab.css', path.join(web, 'tab.css'));
// viewer.html's icon. Next to the page, so that it is found wherever the folder is served from.
copy('images/icon.png', path.join(web, 'icon.png'));

if (dev) {
  await bundle('src/dev/dev.ts', 'dev.js');
  copy('src/dev/dev.html', path.join(web, 'dev.html'));
  copy('src/dev/host.html', path.join(web, 'host.html'));
}

if (webOnly) {
  console.log(`Built ${path.relative(root, web)}/`);
  process.exit(0);
}

// --- pipeline task -----------------------------------------------------------
fs.mkdirSync(taskOut, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(taskSrc, 'src/index.ts')],
  outfile: path.join(taskOut, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
  // task-lib loads its own resource files from its package folder at runtime, so it
  // ships as a regular dependency instead of being bundled.
  external: ['azure-pipelines-task-lib'],
  legalComments: 'eof',
  logLevel: 'warning',
});
for (const f of ['task.json', 'icon.png', 'package.json', 'package-lock.json']) {
  copy(path.join('tasks/PublishStorybook', f), path.join(taskOut, f));
}
if (version || devTask) {
  const taskJson = path.join(taskOut, 'task.json');
  let task = JSON.parse(fs.readFileSync(taskJson, 'utf8'));
  if (version) {
    // Agents cache tasks by version, so every release must carry a new task version too.
    const [Major, Minor, Patch] = version.split('.').map(Number);
    task.version = { Major, Minor, Patch };
  }
  if (devTask) task = { ...task, ...JSON.parse(fs.readFileSync(path.join(taskSrc, 'task.dev.json'), 'utf8')) };
  fs.writeFileSync(taskJson, JSON.stringify(task, null, 2) + '\n');
}
// Don't let the npm_config_* settings of an outer `npm run` leak into this install.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));
execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error', { cwd: taskOut, stdio: 'inherit', env });

console.log(`Built ${path.relative(root, out)}/ (${dev ? 'dev' : 'production'}${version ? `, v${version}` : ''})`);
