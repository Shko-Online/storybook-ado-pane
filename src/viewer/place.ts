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

/**
 * A place in the tab: a Storybook, and a page of it. The tab keeps it in the fragment of the
 * run page's address, so the address someone copies from the browser brings a colleague to
 * the same story.
 *
 * Storybook keeps the story in the query of its own address (`index.html?path=/story/…`), and
 * the fragment is that query as it is, which keeps the link readable:
 *
 *     …/_build/results?buildId=123&view=…#path=/story/components-button--primary
 *
 * `storybook=<id>` is added when the run has more than one Storybook, and a page other than
 * the entry page is written as `at=<address>`.
 */
export interface Place {
  /** Id of the Storybook (StorybookRef.id); the first one when not given. */
  id?: string;
  /** Address inside the Storybook, with query and fragment; its entry page when not given. */
  address?: string;
}

const ID_KEY = 'storybook';
const ADDRESS_KEY = 'at';

/** The fragment for a place (without `#`). `entry` is the Storybook's entry page, e.g. `index.html`. */
export function formatPlace(place: Place, entry: string, withId: boolean): string {
  const parts: string[] = [];
  const address = place.address ?? '';
  if (address === entry || address.startsWith(`${entry}?`)) {
    // Our own two names must not be taken for Storybook's; it uses neither.
    const query = address.slice(entry.length + 1);
    if (query) parts.push(...query.split('&').filter((p) => p && !isOurs(p)));
  } else if (address) {
    parts.push(`${ADDRESS_KEY}=${encodeURIComponent(address)}`);
  }
  if (withId && place.id) parts.push(`${ID_KEY}=${encodeURIComponent(place.id)}`);
  return parts.join('&');
}

/** The place a fragment stands for. Accepts it with or without the leading `#`. */
export function parsePlace(fragment: string | undefined | null, entry: string): Place {
  const place: Place = {};
  const query: string[] = [];
  for (const part of (fragment ?? '').replace(/^#/, '').split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? '' : part.slice(eq + 1);
    if (key === ID_KEY) place.id = decode(value) || undefined;
    else if (key === ADDRESS_KEY) place.address = decode(value) || undefined;
    else query.push(part);
  }
  if (!place.address && query.length > 0) place.address = `${entry}?${query.join('&')}`;
  return place;
}

function isOurs(part: string): boolean {
  return part === ID_KEY || part.startsWith(`${ID_KEY}=`) || part === ADDRESS_KEY || part.startsWith(`${ADDRESS_KEY}=`);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
