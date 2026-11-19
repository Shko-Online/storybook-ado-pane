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
 * Storybook sources for the stories. The real tab reads the artifacts of a run through the
 * Azure DevOps REST API (src/tab/main.ts); here the same StorybookViewer reads the artifacts
 * the demo run published from static files, or from fakes that reproduce its other states.
 */
import JSZip from 'jszip';
import { readStorybookInfo, type StorybookInfo } from '../../src/shared/constants';
import {
  readWithProgress,
  StorybookViewer,
  type StorybookRef,
  type StorybookSource,
  type ViewerOptions,
} from '../../src/viewer/ui';
import { run, type Artifact } from './run-data';

/** What the task recorded about an artifact, when it is a Storybook the demo has the zip of. */
export function storybookOf(artifact: Artifact): StorybookInfo | undefined {
  return artifact.file ? readStorybookInfo(artifact.name, artifact.properties) : undefined;
}

/**
 * The Storybooks the demo run published. Like the tab, it goes by the properties of the
 * run's artifacts, and downloads an artifact as the zip Azure DevOps makes of it.
 */
export class DemoRunSource implements StorybookSource {
  constructor(private readonly artifacts: Artifact[] = run.artifacts) {}

  async list(): Promise<StorybookRef[]> {
    const refs: StorybookRef[] = [];
    for (const artifact of this.artifacts) {
      const info = storybookOf(artifact);
      // As in the tab: the artifact's name identifies the Storybook, also in a link to a story.
      if (info) refs.push({ id: artifact.name, label: info.title, info });
    }
    return refs.sort((a, b) => a.label.localeCompare(b.label));
  }

  async download(ref: StorybookRef, onProgress: (loaded: number, total?: number) => void): Promise<ArrayBuffer> {
    const file = this.artifacts.find((a) => a.name === ref.id)?.file;
    if (!file) throw new Error(`The demo has no artifact named ${ref.id}.`);
    // Relative to the page: the Storybook is served from a folder of a site (GitHub Pages).
    const res = await fetch(new URL(run.assets + file, document.baseURI));
    if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}.`);
    return readWithProgress(res, (loaded, total) => onProgress(loaded, total ?? ref.info?.artifactBytes));
  }
}

/** A run that has published nothing (yet). */
export class EmptySource implements StorybookSource {
  constructor(private readonly inProgress: boolean) {}
  async list(): Promise<StorybookRef[]> {
    return [];
  }
  download(): Promise<ArrayBuffer> {
    throw new Error('nothing to download');
  }
  mayPublishMore(): boolean {
    return this.inProgress;
  }
}

/** The artifacts cannot be listed, e.g. the user lacks access. */
export class FailingListSource implements StorybookSource {
  async list(): Promise<StorybookRef[]> {
    throw new Error('TF400813: The user is not authorized to access this resource.');
  }
  download(): Promise<ArrayBuffer> {
    throw new Error('unreachable');
  }
}

/** A large Storybook on a slow connection: progress moves, the download never finishes. */
export class SlowDownloadSource implements StorybookSource {
  async list(): Promise<StorybookRef[]> {
    return [{ id: 'big', label: 'Design system' }];
  }
  download(_ref: StorybookRef, onProgress: (loaded: number, total?: number) => void): Promise<ArrayBuffer> {
    const total = 48 * 1024 * 1024;
    let loaded = 0;
    const tick = () => {
      loaded = Math.min(total * 0.9, loaded + 1.3 * 1024 * 1024);
      onProgress(loaded, total);
      if (loaded < total * 0.9) window.setTimeout(tick, 400);
    };
    tick();
    return new Promise(() => {});
  }
}

/** The download is not a zip, e.g. a sign-in page came back instead of the artifact. */
export class BrokenArchiveSource implements StorybookSource {
  async list(): Promise<StorybookRef[]> {
    return [{ id: 'broken', label: 'Design system' }];
  }
  async download(): Promise<ArrayBuffer> {
    return new TextEncoder().encode('<html>Sign in to continue</html>').buffer as ArrayBuffer;
  }
}

/** An artifact that holds a website, but not one built by Storybook: it has no iframe.html. */
export class PlainSiteSource implements StorybookSource {
  async list(): Promise<StorybookRef[]> {
    return [{ id: 'site', label: 'Component guidelines' }];
  }
  download(): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file(
      'index.html',
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Component guidelines</title>' +
        '<body style="font: 16px/1.5 system-ui, sans-serif; margin: 2rem; color-scheme: light dark">' +
        '<h1>Component guidelines</h1><p>A plain website, published with the task. It is shown as it is.</p></body></html>',
    );
    return zip.generateAsync({ type: 'arraybuffer' });
  }
}

let mounted: StorybookViewer | undefined;

/**
 * Creates the viewer in `root` and loads its Storybooks. Storybook keeps one page for every
 * story, so the viewer of the previous story is disposed first.
 */
export function mountViewer(root: HTMLElement, source: StorybookSource, options?: ViewerOptions): StorybookViewer {
  mounted?.dispose();
  mounted = new StorybookViewer(root, source, options);
  void mounted.refresh();
  return mounted;
}
