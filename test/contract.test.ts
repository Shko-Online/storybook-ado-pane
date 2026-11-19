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
import { readStorybookInfo } from '../src/shared/constants';
import { describeStorybook } from '../src/shared/details';

test('an artifact without the marker is not a Storybook', () => {
  assert.equal(readStorybookInfo('drop', { localpath: '/a/b', artifactsize: '10' }), undefined);
  assert.equal(readStorybookInfo('drop', undefined), undefined);
  assert.equal(readStorybookInfo('drop', { storybookpane: '' }), undefined);
  assert.equal(readStorybookInfo('drop', { storybookpane: 'yes' }), undefined);
});

test('the properties written by the task are read back', () => {
  const info = readStorybookInfo('storybook', {
    storybookpane: '1',
    storybooktitle: 'Design system',
    storybookarchive: 'storybook.zip',
    storybookentry: 'index.html',
    storybookpublished: '2026-11-19T18:39:25.381Z',
    storybookfiles: '58',
    storybookversion: '10.6.5',
    storybookframework: '@storybook/react-vite',
    storybookstories: '15',
    storybookdocs: '5',
    artifactsize: '2298725',
  });
  assert.deepEqual(info, {
    title: 'Design system',
    entry: 'index.html',
    archive: 'storybook.zip',
    publishedAt: '2026-11-19T18:39:25.381Z',
    fileCount: 58,
    artifactBytes: 2298725,
    storybookVersion: '10.6.5',
    framework: '@storybook/react-vite',
    storyCount: 15,
    docsCount: 5,
  });
});

test('missing properties fall back to the artifact name and index.html', () => {
  const info = readStorybookInfo('storybook-admin', { storybookpane: '1' });
  assert.equal(info?.title, 'storybook-admin');
  assert.equal(info?.entry, 'index.html');
  assert.equal(info?.archive, undefined, 'without the property, the files of the artifact are the Storybook');
  assert.equal(info?.storyCount, undefined);
  assert.equal(info?.artifactBytes, undefined);
});

test('property names are matched without case, and bad numbers are ignored', () => {
  const info = readStorybookInfo('a', { StorybookPane: '1', StorybookTitle: ' Admin ', storybookstories: 'many', storybookfiles: '-3' });
  assert.equal(info?.title, 'Admin');
  assert.equal(info?.storyCount, undefined);
  assert.equal(info?.fileCount, undefined);
});

test('a Storybook is described from project.json and index.json', () => {
  const details = describeStorybook(
    { storybookVersion: '10.6.5', framework: { name: '@storybook/react-vite', options: {} } },
    {
      v: 5,
      entries: {
        'welcome--docs': { type: 'docs' },
        'button--docs': { type: 'docs' },
        'button--primary': { type: 'story' },
        'button--secondary': { type: 'story' },
        'card--plain': { type: 'story' },
      },
    },
  );
  assert.deepEqual(details, { storybookVersion: '10.6.5', framework: '@storybook/react-vite', docsCount: 2, storyCount: 3 });
});

test('Storybook 7 and 8 give their version in the list of their packages', () => {
  const details = describeStorybook(
    {
      framework: { name: '@storybook/html-vite', options: {} },
      storybookPackages: { storybook: { version: '8.6.19' }, '@storybook/html-vite': { version: '8.6.19' } },
    },
    undefined,
  );
  assert.deepEqual(details, { framework: '@storybook/html-vite', storybookVersion: '8.6.19' });
  assert.equal(
    describeStorybook({ framework: { name: '@storybook/react' }, storybookPackages: { '@storybook/react': { version: '7.0.1' } } }, undefined)
      .storybookVersion,
    '7.0.1',
  );
});

test('older Storybooks are described from stories.json', () => {
  const details = describeStorybook(
    { storybookVersion: '6.5.16', framework: 'react' },
    { v: 3, stories: { 'intro--page': { parameters: { docsOnly: true } }, 'button--primary': { parameters: {} } } },
  );
  assert.deepEqual(details, { storybookVersion: '6.5.16', framework: 'react', docsCount: 1, storyCount: 1 });
});

test('files that are missing or of another shape describe nothing', () => {
  assert.deepEqual(describeStorybook(undefined, undefined), {});
  assert.deepEqual(describeStorybook('nope', [1, 2]), {});
  assert.deepEqual(describeStorybook({ storybookVersion: 10 }, { entries: null }), {});
});
