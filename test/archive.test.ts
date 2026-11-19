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
import { test } from 'node:test';
import JSZip from 'jszip';
import { loadArchive } from '../src/viewer/archive';

async function zipOf(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'arraybuffer' });
}

const storybook = (prefix = '') => ({
  [`${prefix}index.html`]: '<!doctype html><html><head></head><body>manager</body></html>',
  [`${prefix}iframe.html`]: '<!doctype html><html><head></head><body>preview</body></html>',
  [`${prefix}index.json`]: JSON.stringify({ v: 5, entries: { 'a--docs': { type: 'docs' }, 'a--b': { type: 'story' } } }),
  [`${prefix}project.json`]: JSON.stringify({ storybookVersion: '10.6.5', framework: { name: '@storybook/react-vite' } }),
  [`${prefix}assets/main.js`]: 'export default 1;',
  [`${prefix}assets/logo.png`]: 'not really a png',
});

/** What Azure DevOps sends for an artifact the task published: the task's zip, in the zip of the artifact. */
async function artifactOf(files: Record<string, string>, artifact = 'storybook', archive = 'storybook.zip') {
  const outer = new JSZip();
  outer.file(`${artifact}/${archive}`, await zipOf(files));
  return outer.generateAsync({ type: 'arraybuffer' });
}

test('a Storybook published as one zip is opened from inside the artifact', async () => {
  const archive = await loadArchive(await artifactOf(storybook()), { archive: 'storybook.zip' });
  assert.equal(archive.entry, 'index.html');
  assert.equal(archive.fileCount, 6);
  assert.ok(archive.looksLikeStorybook);
  assert.equal(await (await archive.read('assets/main.js'))?.text(), 'export default 1;');
});

test("what a tab of its own gets is the Storybook's zip, without the artifact around it", async () => {
  const archive = await loadArchive(await artifactOf(storybook()), { archive: 'storybook.zip' });
  const again = await loadArchive(archive.source);
  assert.equal(again.fileCount, 6);
  assert.ok(again.has('iframe.html'));
  assert.equal(again.source, archive.source);
});

test('a lone zip is opened even when nothing says it holds the Storybook', async () => {
  const archive = await loadArchive(await artifactOf(storybook(), 'drop', 'site.zip'));
  assert.ok(archive.looksLikeStorybook);
  assert.equal(archive.fileCount, 6);
});

test('a zip among the files of a Storybook is just one of its files', async () => {
  const archive = await loadArchive(await zipOf({ ...storybook('storybook/'), 'storybook/downloads/icons.zip': 'not a storybook' }));
  assert.equal(archive.fileCount, 7);
  assert.ok(archive.has('downloads/icons.zip'));
});

test('the folder Azure DevOps wraps an artifact in is not part of the paths', async () => {
  const archive = await loadArchive(await zipOf(storybook('storybook/')));
  assert.equal(archive.entry, 'index.html');
  assert.equal(archive.fileCount, 6);
  assert.ok(archive.looksLikeStorybook);
  assert.ok(archive.has('assets/main.js'));
  assert.ok(!archive.has('storybook/index.html'));
});

test('a zip of the files themselves works too', async () => {
  const archive = await loadArchive(await zipOf(storybook()));
  assert.equal(archive.entry, 'index.html');
  assert.ok(archive.has('iframe.html'));
});

test('the Storybook is the shallowest folder with index.html and iframe.html', async () => {
  const archive = await loadArchive(
    await zipOf({
      'drop/index.html': 'some other page, without an iframe.html next to it',
      'drop/readme.txt': 'not part of the Storybook',
      ...storybook('drop/site/storybook-static/'),
      ...storybook('drop/site/storybook-static/nested/copy/'),
    }),
  );
  assert.ok(archive.looksLikeStorybook);
  assert.ok(archive.has('assets/main.js'));
  assert.ok(archive.has('nested/copy/index.html'), 'files below the Storybook stay reachable');
  assert.ok(!archive.has('readme.txt'), 'files outside the Storybook are left out');
});

test('a folder with only an index.html is shown, and said not to look like a Storybook', async () => {
  const archive = await loadArchive(await zipOf({ 'site/index.html': '<p>hello</p>', 'site/app.js': '1' }));
  assert.equal(archive.entry, 'index.html');
  assert.ok(!archive.looksLikeStorybook);
});

test('files are unpacked on request, with their content type', async () => {
  const archive = await loadArchive(await zipOf(storybook('storybook/')));
  const script = await archive.read('assets/main.js');
  assert.equal(script?.type, 'text/javascript;charset=utf-8');
  assert.equal(await script?.text(), 'export default 1;');
  assert.equal((await archive.read('assets/logo.png'))?.type, 'image/png');
  assert.equal((await archive.read('index.json'))?.type, 'application/json;charset=utf-8');
  assert.equal(archive.read('missing.js'), undefined);
  assert.equal(archive.read('assets/main.js'), archive.read('assets/main.js'), 'the same file is unpacked once');
});

test('the Storybook describes itself', async () => {
  const archive = await loadArchive(await zipOf(storybook('storybook/')));
  assert.deepEqual(await archive.details(), {
    storybookVersion: '10.6.5',
    framework: '@storybook/react-vite',
    docsCount: 1,
    storyCount: 1,
  });
});

test('an archive without an index.html is refused', async () => {
  await assert.rejects(loadArchive(await zipOf({ 'drop/readme.txt': 'nothing to show' })), /does not contain a Storybook/);
});

test('something that is not a zip is refused', async () => {
  const signIn = new TextEncoder().encode('<html>Sign in to continue</html>').buffer as ArrayBuffer;
  await assert.rejects(loadArchive(signIn), /not a zip archive/);
});
