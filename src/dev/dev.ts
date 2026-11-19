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
 * Local harness for the viewer. Serves the same StorybookViewer as the Azure DevOps tab,
 * fed from zips in .fixtures/ (see scripts/make-fixtures.mjs) or a picked file.
 */
import { showBanner } from '../shared/banner';
import { DEFAULT_ENTRY, readStorybookInfo } from '../shared/constants';
import { TAB_NAME } from '../shared/product';
import { formatPlace, parsePlace } from '../viewer/place';
import { setScheme, type Scheme } from '../viewer/theme';
import { readWithProgress, StorybookViewer, type StorybookRef, type StorybookSource } from '../viewer/ui';

class LocalSource implements StorybookSource {
  private picked = new Map<string, File>();

  addFile(file: File): StorybookRef {
    this.picked.set(file.name, file);
    return { id: `file:${file.name}`, label: `${file.name} (local file)` };
  }

  async list(): Promise<StorybookRef[]> {
    const names: string[] = await (await fetch('/fixtures/')).json();
    const fixtures = await Promise.all(
      names.map(async (n): Promise<StorybookRef> => {
        const artifact = n.replace(/\.zip$/, '');
        // The properties the artifact would carry in Azure DevOps (see scripts/make-fixtures.mjs).
        const res = await fetch(`/fixtures/${encodeURIComponent(artifact)}.properties.json`);
        const info = res.ok ? readStorybookInfo(artifact, await res.json()) : undefined;
        return { id: `fixture:${n}`, label: info?.title ?? artifact, info };
      }),
    );
    return [...fixtures, ...[...this.picked.keys()].map((n) => ({ id: `file:${n}`, label: `${n} (local file)` }))];
  }

  async download(ref: StorybookRef, onProgress: (loaded: number, total?: number) => void): Promise<ArrayBuffer> {
    const [kind, name] = [ref.id.slice(0, ref.id.indexOf(':')), ref.id.slice(ref.id.indexOf(':') + 1)];
    if (kind === 'file') return this.picked.get(name)!.arrayBuffer();
    const res = await fetch(`/fixtures/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return readWithProgress(res, onProgress);
  }
}

showBanner(TAB_NAME);

const params = new URLSearchParams(location.search);

// ?nosw stands in for a browser that does not allow service workers in embedded pages.
if (params.has('nosw')) {
  navigator.serviceWorker.register = () =>
    Promise.reject(new DOMException('Service workers are turned off for this test (?nosw).', 'SecurityError'));
}

// ?theme=dark|light stands in for the Azure DevOps theme.
const theme = params.get('theme');
if (theme === 'dark' || theme === 'light') {
  setScheme(theme as Scheme);
  document.documentElement.dataset.viewerTheme = theme;
}

// This page's own fragment stands in for the fragment of the run page's address.
let fragment = location.hash.slice(1);
const source = new LocalSource();
const viewer = new StorybookViewer(document.getElementById('app')!, source, {
  start: parsePlace(fragment, DEFAULT_ENTRY),
  onNavigate: (place, entry, count) => {
    const next = formatPlace(place, entry, count > 1);
    if (next === fragment) return;
    fragment = next;
    history.replaceState(null, '', `#${next}`);
  },
});
window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (next === fragment) return;
  fragment = next;
  void viewer.goTo(parsePlace(next, DEFAULT_ENTRY));
});
void viewer.refresh();

document.getElementById('pick')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    source.addFile(file);
    void viewer.refresh();
  }
});

// Dev-only: lets the fake host page (host.html) press toolbar buttons inside this
// cross-origin frame, so popup behaviour can be tested in a partitioned iframe.
window.addEventListener('message', (e) => {
  if (e.data?.type === 'dev-click') (document.querySelector(e.data.selector) as HTMLElement | null)?.click();
  if (e.data?.type === 'dev-pick') {
    const picker = document.querySelector('.sbp-picker') as HTMLSelectElement;
    picker.value = [...picker.options].find((o) => o.text.includes(e.data.label))?.value ?? picker.value;
    picker.dispatchEvent(new Event('change'));
  }
});
