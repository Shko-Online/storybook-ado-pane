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

import JSZip from 'jszip';
import { DEFAULT_ENTRY } from '../shared/constants';
import { describeStorybook, type StorybookDetails } from '../shared/details';
import { mimeType } from './mime';

export type { StorybookDetails };

/**
 * A published Storybook, held in memory as the zip it was downloaded as. Files are unpacked
 * one at a time, when the Storybook asks for them: a Storybook only loads the code of the
 * stories that are opened. Paths are relative to the Storybook's folder, POSIX style, without
 * a leading slash.
 */
export class StorybookArchive {
  private readonly unpacked = new Map<string, Promise<Blob>>();

  constructor(
    /** Page to open first. */
    readonly entry: string,
    private readonly files: Map<string, JSZip.JSZipObject>,
    /** The zip of the Storybook itself: all a tab of its own needs to show it too. */
    readonly source: ArrayBuffer,
  ) {}

  get fileCount(): number {
    return this.files.size;
  }

  /** True when the folder has the page that renders stories, as every Storybook build does. */
  get looksLikeStorybook(): boolean {
    return this.files.has('iframe.html');
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  /** The file as a typed Blob, or undefined when the Storybook has no such file. */
  read(path: string): Promise<Blob> | undefined {
    const file = this.files.get(path);
    if (!file) return undefined;
    let blob = this.unpacked.get(path);
    if (!blob) {
      blob = file.async('uint8array').then((bytes) => new Blob([bytes as BlobPart], { type: mimeType(path) }));
      // A failed read is not remembered, so the next request tries again.
      blob.catch(() => this.unpacked.delete(path));
      this.unpacked.set(path, blob);
    }
    return blob;
  }

  /** Version, framework and number of stories, from the files Storybook writes next to its pages. */
  async details(): Promise<StorybookDetails> {
    const project = await this.json('project.json');
    // index.json since Storybook 7; stories.json before that.
    const index = (await this.json('index.json')) ?? (await this.json('stories.json'));
    return describeStorybook(project, index);
  }

  private async json(path: string): Promise<any> {
    try {
      const blob = await this.read(path);
      return blob ? JSON.parse(await blob.text()) : undefined;
    } catch {
      return undefined;
    }
  }
}

export interface LoadOptions {
  /** Page to open first; `index.html` unless told otherwise. */
  entry?: string;
  /** Name of the zip file, inside the download, that holds the Storybook (see PROPERTY.archive). */
  archive?: string;
}

/**
 * Opens a published Storybook from what Azure DevOps sends for its artifact: a zip of the
 * artifact's files, under a folder named after the artifact.
 *
 * The task publishes the Storybook as one zip file, so the Storybook is a zip inside that
 * zip. An artifact may also hold the files of a Storybook as they are, and a zip made by hand
 * may wrap them in any folder. Either way the Storybook is wherever its entry page is: the
 * shallowest folder that has both `index.html` and `iframe.html`.
 */
export async function loadArchive(data: ArrayBuffer | Blob, options: LoadOptions = {}): Promise<StorybookArchive> {
  let source = data instanceof Blob ? await data.arrayBuffer() : data;
  let zip = await open(source);

  const packed = findPacked(zip, options.archive);
  if (packed) {
    source = await packed.async('arraybuffer');
    zip = await open(source);
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const names = entries.map(nameOf);

  const wanted = (options.entry ?? DEFAULT_ENTRY).replace(/\\/g, '/').replace(/^\.?\/+/, '') || DEFAULT_ENTRY;
  const located = findRoot(names, wanted) ?? (wanted === DEFAULT_ENTRY ? undefined : findRoot(names, DEFAULT_ENTRY));
  if (!located) throw new Error(`The artifact does not contain a Storybook: there is no ${DEFAULT_ENTRY} in it.`);

  const files = new Map<string, JSZip.JSZipObject>();
  for (const f of entries) {
    const n = nameOf(f);
    if (n.startsWith(located.root)) files.set(n.slice(located.root.length), f);
  }
  return new StorybookArchive(located.entry, files, source);
}

async function open(data: ArrayBuffer): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(data);
  } catch {
    throw new Error('The download is not a zip archive.');
  }
}

const nameOf = (f: JSZip.JSZipObject) => f.name.replace(/\\/g, '/').replace(/^\/+/, '');

/** The zip file that holds the Storybook, when the Storybook was published as one. */
function findPacked(zip: JSZip, archive: string | undefined): JSZip.JSZipObject | undefined {
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (archive) {
    const named = files.find((f) => nameOf(f) === archive || nameOf(f).endsWith(`/${archive}`));
    if (named) return named;
  }
  // Not told (a zip made by hand): a single zip file, and no page to show instead.
  const zips = files.filter((f) => /\.zip$/i.test(f.name));
  const hasPage = files.some((f) => /(^|\/)index\.html?$/i.test(nameOf(f)));
  return zips.length === 1 && !hasPage ? zips[0] : undefined;
}

function findRoot(names: string[], entry: string): { root: string; entry: string } | undefined {
  const all = new Set(names);
  const roots = names
    .filter((n) => n === entry || n.endsWith(`/${entry}`))
    .map((n) => n.slice(0, n.length - entry.length))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const root = roots.find((r) => all.has(`${r}iframe.html`)) ?? roots[0];
  return root === undefined ? undefined : { root, entry };
}
