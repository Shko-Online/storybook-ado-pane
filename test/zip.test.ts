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
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { listFolder, writeZip } from '../tasks/PublishStorybook/src/zip';

function folder(files: Record<string, string | Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbp-zip-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const compressible = 'export const story = "Primary";\n'.repeat(2000);
const random = crypto.randomBytes(20_000);
const files = {
  'index.html': '<!doctype html><title>Storybook</title>',
  'iframe.html': '<!doctype html>',
  'assets/main.js': compressible,
  'assets/deep/er/chunk.js': 'export default 1;',
  'assets/të dhëna 1.json': '{"ok":true}',
  'assets/photo.png': random,
  'assets/noise.bin': random,
  'empty.txt': '',
};

test('the zip holds every file of the folder, with the same content', async () => {
  const dir = folder(files);
  const target = path.join(folder({}), 'storybook.zip');
  const size = writeZip(target, listFolder(dir));
  assert.equal(size, fs.statSync(target).size);

  const zip = await JSZip.loadAsync(fs.readFileSync(target));
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  assert.deepEqual(entries.map((f) => f.name).sort(), Object.keys(files).sort());
  for (const [name, content] of Object.entries(files)) {
    const unpacked = Buffer.from(await zip.file(name)!.async('uint8array'));
    assert.ok(unpacked.equals(Buffer.from(content)), name);
  }
});

test('text is compressed; what is already compressed, or does not shrink, is stored as it is', () => {
  const dir = folder(files);
  const target = path.join(folder({}), 'storybook.zip');
  const size = writeZip(target, listFolder(dir));
  assert.ok(size < compressible.length / 10 + 2 * random.length + 2000, `text did not shrink: ${size} bytes`);
  assert.ok(size > 2 * random.length, 'random bytes cannot shrink');
});

test('files come in a fixed order, with forward slashes', () => {
  const listed = listFolder(folder(files)).map((f) => f.path);
  assert.deepEqual(listed, [...listed].sort());
  assert.ok(listed.includes('assets/deep/er/chunk.js'));
  assert.ok(listed.every((p) => !p.includes('\\') && !p.startsWith('/')));
});

test('a linked file is included, a dangling link is not', { skip: process.platform === 'win32' }, () => {
  const dir = folder({ 'index.html': 'x', 'shared/logo.txt': 'logo' });
  fs.symlinkSync(path.join(dir, 'shared', 'logo.txt'), path.join(dir, 'logo.txt'));
  fs.symlinkSync(path.join(dir, 'nowhere.txt'), path.join(dir, 'broken.txt'));
  assert.deepEqual(listFolder(dir).map((f) => f.path), ['index.html', 'logo.txt', 'shared/logo.txt']);
});

test('other tools read the zip', { skip: spawnSync('unzip', ['-v']).status !== 0 }, () => {
  const target = path.join(folder({}), 'storybook.zip');
  writeZip(target, listFolder(folder(files)));
  const check = spawnSync('unzip', ['-t', target], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /No errors detected/);
});

test('an empty folder gives an empty, valid zip', async () => {
  const target = path.join(folder({}), 'storybook.zip');
  writeZip(target, []);
  assert.equal(Object.keys((await JSZip.loadAsync(fs.readFileSync(target))).files).length, 0);
});
