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

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { readStorybookInfo } from '../src/shared/constants';

const root = process.cwd();
const task = path.join(root, 'build', 'tasks', 'PublishStorybook', 'index.js');

/** Runs the built task the way the agent does: inputs and variables in the environment. */
function runTask(inputs: Record<string, string>, variables: Record<string, string> = {}) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    SYSTEM_DEFAULTWORKINGDIRECTORY: root,
    SYSTEM_HOSTTYPE: 'build',
    // The task library keeps a key file in the agent's temp folder (.taskkey).
    AGENT_TEMPDIRECTORY: os.tmpdir(),
  };
  for (const [name, value] of Object.entries(inputs)) env[`INPUT_${name.toUpperCase()}`] = value;
  Object.assign(env, variables);
  const { stdout } = spawnSync(process.execPath, [task], { env, encoding: 'utf8' });
  const lines = stdout.split(/\r?\n/);
  const command = (name: string) => lines.filter((l) => l.startsWith(`##vso[${name}`));
  return { stdout, upload: command('artifact.upload'), complete: command('task.complete')[0] ?? '', warnings: command('task.issue') };
}

/** `##vso[area.action key=value;key=value]data`, unescaped as the agent does. */
function parse(line: string): { properties: Record<string, string>; data: string } {
  const end = line.indexOf(']');
  const head = line.slice(line.indexOf(' ') + 1, end);
  const unescape = (s: string) =>
    s.replace(/%0D/g, '\r').replace(/%0A/g, '\n').replace(/%5D/g, ']').replace(/%3B/g, ';').replace(/%AZP25/g, '%');
  const properties: Record<string, string> = {};
  for (const pair of head.split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0) properties[pair.slice(0, eq)] = unescape(pair.slice(eq + 1));
  }
  return { properties, data: unescape(line.slice(end + 1)) };
}

function storybookFolder(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbp-test-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const built = {
  'index.html': '<html></html>',
  'iframe.html': '<html></html>',
  'assets/main.js': 'export default 1;',
  'project.json': JSON.stringify({ storybookVersion: '10.6.5', framework: { name: '@storybook/react-vite' } }),
  'index.json': JSON.stringify({ v: 5, entries: { 'a--docs': { type: 'docs' }, 'a--b': { type: 'story' }, 'a--c': { type: 'story' } } }),
};

/** The files in the zip the task asked the agent to upload. */
async function published(upload: string): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(fs.readFileSync(parse(upload).data));
  const files: Record<string, string> = {};
  for (const file of Object.values(zip.files)) if (!file.dir) files[file.name] = await file.async('string');
  return files;
}

test('publishes the folder, in one zip, as an artifact that the tab recognises', async () => {
  const dir = storybookFolder(built);
  const run = runTask({ storybookDir: dir, artifactName: 'storybook-admin', title: 'Admin; app [beta]\n100%' });
  assert.match(run.complete, /result=Succeeded/);
  assert.equal(run.upload.length, 1);

  const { properties, data } = parse(run.upload[0]);
  assert.equal(path.basename(data), 'storybook.zip');
  assert.deepEqual(await published(run.upload[0]), built, 'the zip holds the folder, with its files at the top');
  assert.equal(properties.artifactname, 'storybook-admin');
  assert.equal(properties.containerfolder, 'storybook-admin');

  // What the agent keeps as properties of the artifact is what the tab reads.
  const { artifactname, containerfolder, ...kept } = properties;
  const info = readStorybookInfo(artifactname, { ...kept, artifactsize: '123' });
  assert.equal(info?.title, 'Admin; app [beta] 100%', 'the title survives the escaping, on one line');
  assert.equal(info?.archive, 'storybook.zip');
  assert.equal(info?.entry, 'index.html');
  assert.equal(info?.fileCount, 5);
  assert.equal(info?.storybookVersion, '10.6.5');
  assert.equal(info?.framework, '@storybook/react-vite');
  assert.equal(info?.storyCount, 2);
  assert.equal(info?.docsCount, 1);
  assert.ok(!Number.isNaN(Date.parse(info?.publishedAt ?? '')));
});

test('the artifact name and title have defaults', () => {
  const run = runTask({ storybookDir: storybookFolder(built) });
  const { properties } = parse(run.upload[0]);
  assert.equal(properties.artifactname, 'storybook');
  assert.equal(properties.storybooktitle, 'storybook');
});

test('a relative folder is resolved against the working directory', async () => {
  const dir = storybookFolder(built);
  const run = runTask({ storybookDir: path.basename(dir) }, { SYSTEM_DEFAULTWORKINGDIRECTORY: path.dirname(dir) });
  assert.match(run.complete, /result=Succeeded/);
  assert.deepEqual(Object.keys(await published(run.upload[0])).sort(), Object.keys(built).sort());
});

test('two Storybooks published by one job do not share a zip', () => {
  const [a, b] = [runTask({ storybookDir: storybookFolder(built) }), runTask({ storybookDir: storybookFolder(built) })];
  assert.notEqual(parse(a.upload[0]).data, parse(b.upload[0]).data);
});

test('a missing folder is a warning by default, and nothing is published', () => {
  const run = runTask({ storybookDir: path.join(os.tmpdir(), 'sbp-test-does-not-exist') });
  assert.equal(run.upload.length, 0);
  assert.match(run.complete, /result=SucceededWithIssues/);
  assert.match(run.warnings.join('\n'), /type=warning.*Storybook folder not found/);
});

test('ifMissing decides what a missing Storybook means', () => {
  const dir = storybookFolder({ 'readme.txt': 'not built yet' });
  assert.match(runTask({ storybookDir: dir, ifMissing: 'error' }).complete, /result=Failed.*No index\.html/);
  const ignored = runTask({ storybookDir: dir, ifMissing: 'ignore' });
  assert.match(ignored.complete, /result=Skipped/);
  assert.equal(ignored.upload.length, 0);
});

test('a folder without iframe.html is published with a warning', () => {
  const run = runTask({ storybookDir: storybookFolder({ 'index.html': '<html></html>' }) });
  assert.equal(run.upload.length, 1);
  assert.match(run.warnings.join('\n'), /does not look like a Storybook build/);
  assert.match(run.complete, /result=Succeeded;/);
});

test('an artifact name Azure DevOps would refuse fails the task', () => {
  const run = runTask({ storybookDir: storybookFolder(built), artifactName: 'story/book' });
  assert.equal(run.upload.length, 0);
  assert.match(run.complete, /result=Failed.*not valid/);
});

test('a classic release cannot publish artifacts', () => {
  const run = runTask({ storybookDir: storybookFolder(built) }, { SYSTEM_HOSTTYPE: 'release' });
  assert.equal(run.upload.length, 0);
  assert.match(run.complete, /result=Failed.*build pipeline/);
});
