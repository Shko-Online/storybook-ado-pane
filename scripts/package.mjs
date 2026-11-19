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

// Builds and packages the extension into out/.
//   node scripts/package.mjs                      → production extension, version from vss-extension.json
//   node scripts/package.mjs --version 1.4.0      → stamps 1.4.0 into the manifest and task.json (releases)
//   node scripts/package.mjs --dev [--version …]  → private "-dev" variant for internal use
//                                                   (vss-extension.dev.json), with its own task,
//                                                   PublishStorybookDev (task.dev.json)
// Prints the path of the package on the last line.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const versionArg = args.indexOf('--version');
const version = versionArg >= 0 ? args[versionArg + 1] : undefined;

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit' });

run(process.execPath, ['scripts/build.mjs', ...(version ? ['--version', version] : []), ...(dev ? ['--dev-task'] : [])]);

const overrides = {
  ...(dev ? JSON.parse(fs.readFileSync(path.join(root, 'vss-extension.dev.json'), 'utf8')) : {}),
  ...(version ? { version } : {}),
};

// The dev extension carries its own task (see task.dev.json), and its tab must list that task.
// tfx appends "contributions" from --override instead of replacing them, so the dev variant is
// packaged from a generated copy of the manifest, next to the original so relative paths hold.
let manifest = 'vss-extension.json';
if (dev) {
  const publicTask = JSON.parse(fs.readFileSync(path.join(root, 'tasks/PublishStorybook/task.json'), 'utf8'));
  const devTask = JSON.parse(fs.readFileSync(path.join(root, 'tasks/PublishStorybook/task.dev.json'), 'utf8'));
  const text = fs.readFileSync(path.join(root, manifest), 'utf8');
  if (!text.includes(publicTask.id)) throw new Error(`vss-extension.json does not mention the task id ${publicTask.id}.`);
  manifest = 'vss-extension.dev.generated.json';
  fs.writeFileSync(path.join(root, manifest), text.split(publicTask.id).join(devTask.id));
}

fs.rmSync(path.join(root, 'out'), { recursive: true, force: true });
try {
  run('npx', [
    '--no-install',
    'tfx',
    'extension',
    'create',
    '--manifest-globs',
    manifest,
    '--output-path',
    'out',
    '--override',
    JSON.stringify(overrides),
    '--no-prompt',
  ]);
} finally {
  if (dev) fs.rmSync(path.join(root, manifest), { force: true });
}

// The Marketplace rejects packages that contain SVG files; say so here instead of at upload.
const vsix = fs.readdirSync(path.join(root, 'out')).find((f) => f.endsWith('.vsix'));
if (!vsix) throw new Error('tfx did not write a .vsix to out/.');
const { default: JSZip } = await import('jszip');
const packaged = await JSZip.loadAsync(fs.readFileSync(path.join(root, 'out', vsix)));
const svgs = Object.keys(packaged.files).filter((f) => /\.svg$/i.test(f));
if (svgs.length > 0) {
  throw new Error(`The package contains SVG files, which the Marketplace does not accept:\n  ${svgs.join('\n  ')}`);
}
console.log(path.join('out', vsix));
