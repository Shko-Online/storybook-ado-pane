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
import { formatPlace, parsePlace } from '../src/viewer/place';

const ENTRY = 'index.html';

test("a story is written as Storybook's own query", () => {
  const address = 'index.html?path=/story/components-button--primary';
  assert.equal(formatPlace({ id: 'storybook', address }, ENTRY, false), 'path=/story/components-button--primary');
  assert.deepEqual(parsePlace('path=/story/components-button--primary', ENTRY), { address });
  assert.deepEqual(parsePlace('#path=/story/components-button--primary', ENTRY), { address }, 'with the leading #');
});

test('the Storybook is named when the run has more than one', () => {
  const place = { id: 'storybook-admin', address: 'index.html?path=/docs/welcome--docs&globals=theme:dark' };
  const fragment = formatPlace(place, ENTRY, true);
  assert.equal(fragment, 'path=/docs/welcome--docs&globals=theme:dark&storybook=storybook-admin');
  assert.deepEqual(parsePlace(fragment, ENTRY), place);
});

test('a name that needs escaping survives', () => {
  const place = { id: 'story book & co', address: 'index.html?path=/story/a--b' };
  assert.deepEqual(parsePlace(formatPlace(place, ENTRY, true), ENTRY), place);
});

test('the entry page alone is an empty fragment', () => {
  assert.equal(formatPlace({ id: 'storybook', address: 'index.html' }, ENTRY, false), '');
  assert.equal(formatPlace({ id: 'storybook' }, ENTRY, false), '');
  assert.deepEqual(parsePlace('', ENTRY), {});
  assert.deepEqual(parsePlace(undefined, ENTRY), {});
  assert.deepEqual(parsePlace('storybook=storybook-admin', ENTRY), { id: 'storybook-admin' });
});

test('a page other than the entry page keeps its whole address', () => {
  const place = { id: 'storybook', address: 'iframe.html?id=components-button--primary&viewMode=story#top' };
  const fragment = formatPlace(place, ENTRY, false);
  assert.equal(fragment, 'at=iframe.html%3Fid%3Dcomponents-button--primary%26viewMode%3Dstory%23top');
  assert.deepEqual(parsePlace(fragment, ENTRY), { address: place.address });
});

test("our own names in a Storybook's query do not end up twice", () => {
  const fragment = formatPlace({ id: 'b', address: 'index.html?path=/story/a--b&storybook=x&at=y' }, ENTRY, true);
  assert.equal(fragment, 'path=/story/a--b&storybook=b');
});
