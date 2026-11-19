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
 * viewer.html: shows one Storybook in its own browser tab.
 *
 * Opened by the "Storybook" tab (see StorybookViewer.openInNewTab). This page cannot call
 * Azure DevOps itself, so it asks its opener for the Storybook's zip and serves it from
 * memory, just like the tab does. Its own URL fragment remembers which story is shown, so
 * reloading keeps the place as long as the opener is still open.
 */
import { showBanner } from '../shared/banner';
import { TAB_NAME } from '../shared/product';
import { SESSION_MARK } from '../shared/protocol';
import { loadArchive } from '../viewer/archive';
import { StorybookHost } from '../viewer/host';
import { ensureServiceWorker } from '../viewer/sw-client';
import { setScheme, type Scheme } from '../viewer/theme';
import { describe, type PopupStorybook } from '../viewer/ui';
import { createUpsellLink } from '../viewer/upsell';

showBanner(TAB_NAME);

const status = document.getElementById('status')!;
const frame = document.getElementById('frame') as HTMLIFrameElement;
const notice = document.getElementById('notice')!;
const title = document.getElementById('title')!;
document.getElementById('actions')!.append(createUpsellLink());

/** How long the Storybook may take to answer from its frame. */
const START_TIMEOUT_MS = 20_000;

const state = new URLSearchParams(location.hash.slice(1));
let host: StorybookHost | undefined;
let name = TAB_NAME;
let startTimer: number | undefined;

function showNotice(message: string): void {
  notice.querySelector('span')!.textContent = message;
  notice.hidden = false;
}

function showStatus(text: string, kind: 'busy' | 'error'): void {
  status.textContent = text;
  status.dataset.kind = kind;
  status.hidden = false;
}

/** The Azure DevOps theme of the tab this was opened from, or else the system's. */
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let openerScheme: Scheme | undefined;
function applyScheme(): void {
  setScheme(openerScheme);
  document.documentElement.dataset.viewerTheme = openerScheme ?? (systemDark.matches ? 'dark' : 'light');
}
systemDark.addEventListener('change', applyScheme);
applyScheme();

/** Keeps this page's address and title in step with the story shown in the frame. */
function followStorybook(): void {
  if (!host) return;
  try {
    const page = frame.contentWindow;
    const address = host.addressOf(page?.location.href ?? '');
    if (address === undefined) return;
    const fragment = '#' + new URLSearchParams({ at: address }).toString();
    if (fragment !== location.hash) history.replaceState(null, '', fragment);
    const shown = page?.document.title;
    document.title = shown ? `${shown} · ${name}` : name;
  } catch {
    // The frame shows another site; keep the last known place.
  }
}
// Storybook changes its address with the History API, which raises no event out here.
window.setInterval(followStorybook, 1_000);

async function show(storybook: PopupStorybook): Promise<void> {
  openerScheme = storybook.scheme;
  applyScheme();
  showStatus('Opening Storybook…', 'busy');
  const archive = await loadArchive(storybook.data, { entry: storybook.entry });
  name = storybook.name;
  document.title = name;
  title.textContent = name;

  try {
    await ensureServiceWorker();
  } catch (err) {
    showStatus(
      'This browser window does not let the page start the service worker that shows the Storybook from memory. ' +
        'Private windows of some browsers do not. Open the pipeline run in a regular window, or download the ' +
        `Storybook from the run’s artifacts. (${describe(err)})`,
      'error',
    );
    return;
  }

  host?.dispose();
  // Without onOpenPage, pages the Storybook opens in a new tab load straight from its
  // address: in a tab of its own this page shares its service worker with them.
  const current = (host = new StorybookHost(archive, {
    onNotice: showNotice,
    onReady: () => window.clearTimeout(startTimer),
  }));

  // Go back to the story this tab showed before a reload, or was opened for.
  let url = current.entryUrl;
  const at = state.get('at');
  if (at) {
    try {
      const wanted = new URL(current.urlOf(at)).href;
      if (wanted.startsWith(current.baseUrl)) url = wanted;
    } catch {
      // not an address; start from the entry page
    }
  }

  showStatus('Starting Storybook…', 'busy');
  window.clearTimeout(startTimer);
  startTimer = window.setTimeout(() => {
    if (host === current && !status.hidden) showStatus('The Storybook did not start. Reload the page to try again.', 'error');
  }, START_TIMEOUT_MS);
  frame.src = url;
}

frame.addEventListener('load', () => {
  if (!host) return;
  try {
    const page = frame.contentWindow as any;
    if (!page || !String(page.location.href).startsWith(host.baseUrl)) return;
    window.clearTimeout(startTimer);
    if (page[SESSION_MARK] === host.session) status.hidden = true;
    else showStatus('The service worker did not answer for the Storybook. Reload the page to try again.', 'error');
  } catch {
    // The frame shows another site.
  }
  followStorybook();
});
notice.querySelector('button')!.addEventListener('click', () => (notice.hidden = true));

const opener = window.opener as Window | null;
if (!opener) {
  showStatus(
    `This page shows a Storybook opened from the “${TAB_NAME}” tab of a pipeline run. ` +
      'Open the run in Azure DevOps and use “Open in new tab” again.',
    'error',
  );
} else {
  let received = false;
  window.addEventListener('message', (e) => {
    if (e.source !== opener || e.data?.type !== 'sbp-storybook' || received) return;
    received = true;
    show(e.data as PopupStorybook).catch((err) => showStatus(`Could not open the Storybook. ${describe(err)}`, 'error'));
  });
  showStatus('Loading Storybook…', 'busy');
  opener.postMessage({ type: 'sbp-ready' }, '*');
  setTimeout(() => {
    if (!received) {
      showStatus(
        'The Azure DevOps tab that opened this page is no longer available. ' +
          `Open the run’s “${TAB_NAME}” tab and use “Open in new tab” again.`,
        'error',
      );
    }
  }, 15_000);
}
