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

// Makes the Storybooks the dev harness shows, in .fixtures/, the way the tab gets them from
// Azure DevOps. For each one it runs the built task (exactly as the agent would), reads the
// `##vso[artifact.upload …]` command the task prints, and then plays the agent and the server:
//   <artifact>.zip              the artifact as it is downloaded: the task's zip, inside a zip,
//                               under a folder named after the artifact
//   <artifact>.properties.json  the properties the artifact would carry
// Prerequisites: `npm run build`, and for the sample `cd samples/demo && npm ci && npm run build-storybook`.
// Any other built Storybook can be added: `node scripts/make-fixtures.mjs --add <folder>:<artifact>:<title>`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, '.fixtures');
const task = path.join(root, 'build', 'tasks', 'PublishStorybook', 'index.js');
if (!fs.existsSync(task)) throw new Error('The task is not built yet. Run `npm run build` first.');

fs.rmSync(fixtures, { recursive: true, force: true });
fs.mkdirSync(fixtures, { recursive: true });

const sources = [
  // The sample project: a real Storybook.
  { dir: 'samples/demo/storybook-static', artifact: 'storybook', title: 'Design system' },
  // Not a Storybook, but it does what Storybooks do and lists what works (see its iframe.html).
  { dir: 'scripts/fixtures/selftest', artifact: 'selftest', title: 'Viewer self-test' },
];

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] !== '--add') continue;
  const [dir, artifact, title] = (process.argv[++i] ?? '').split(':');
  if (!dir || !artifact) throw new Error('--add takes <folder>:<artifact>[:<title>]');
  sources.push({ dir, artifact, title: title ?? artifact });
}

for (const { dir, artifact, title } of sources) {
  if (!fs.existsSync(path.resolve(root, dir))) {
    console.warn(`skip ${dir}: build it first (cd samples/demo && npm ci && npm run build-storybook)`);
    continue;
  }
  const out = execFileSync(process.execPath, [task], {
    env: {
      ...process.env,
      INPUT_STORYBOOKDIR: dir,
      INPUT_ARTIFACTNAME: artifact,
      INPUT_TITLE: title,
      INPUT_IFMISSING: 'error',
      SYSTEM_DEFAULTWORKINGDIRECTORY: root,
      SYSTEM_HOSTTYPE: 'build',
      // The task library keeps a key file in the agent's temp folder (.taskkey).
      AGENT_TEMPDIRECTORY: fixtures,
    },
  }).toString();

  const upload = out.split('\n').find((l) => l.startsWith('##vso[artifact.upload '));
  if (!upload) throw new Error(`The task did not publish ${dir}:\n${out}`);
  const { properties, data } = parseCommand(upload);

  // What the agent does with the command: it uploads the file the command points at (the zip
  // the task made) into the container folder, and keeps the properties it does not know.
  const { containerfolder, artifactname, ...custom } = properties;
  const uploaded = fs.readFileSync(data);
  const artifactProperties = { ...custom, artifactsize: String(uploaded.length) };

  // What the server does when the artifact is downloaded: a zip with the container folder on top.
  const zip = new JSZip();
  zip.file(`${containerfolder}/${path.basename(data)}`, uploaded);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(path.join(fixtures, `${artifactname}.zip`), bytes);
  fs.writeFileSync(path.join(fixtures, `${artifactname}.properties.json`), JSON.stringify(artifactProperties, null, 2));
  fs.rmSync(path.dirname(data), { recursive: true, force: true });

  const done = out.split('\n').find((l) => l.startsWith('##vso[task.complete'));
  console.log(`${artifactname}.zip  ${(bytes.length / 1024 / 1024).toFixed(1)} MB  ${done ?? ''}`);
}

/** `##vso[area.action key=value;key=value]data`, unescaped as the agent does. */
function parseCommand(line) {
  const end = line.indexOf(']');
  const head = line.slice('##vso['.length, end);
  const space = head.indexOf(' ');
  const unescape = (s) =>
    s.replace(/%0D/g, '\r').replace(/%0A/g, '\n').replace(/%5D/g, ']').replace(/%3B/g, ';').replace(/%AZP25/g, '%');
  const properties = {};
  for (const pair of head.slice(space + 1).split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0) properties[pair.slice(0, eq)] = unescape(pair.slice(eq + 1));
  }
  return { properties, data: unescape(line.slice(end + 1)) };
}
