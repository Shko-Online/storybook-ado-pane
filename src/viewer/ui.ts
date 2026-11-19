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

import type { StorybookInfo } from '../shared/constants';
import { TASK_NAME } from '../shared/product';
import { SESSION_MARK } from '../shared/protocol';
import { loadArchive, type StorybookArchive, type StorybookDetails } from './archive';
import { StorybookHost } from './host';
import type { Place } from './place';
import { ensureServiceWorker, ServiceWorkerUnavailable } from './sw-client';
import { currentScheme, type Scheme } from './theme';
import { createUpsellLink } from './upsell';

export interface StorybookRef {
  /** Stable identifier, used to keep the selection across refreshes. */
  id: string;
  label: string;
  /** What the task recorded about the Storybook, when it is known before the download. */
  info?: StorybookInfo;
}

/** Where Storybooks come from: build artifacts in Azure DevOps, local files in the dev harness. */
export interface StorybookSource {
  list(): Promise<StorybookRef[]>;
  /** The download of the Storybook (see loadArchive). `total` is given when the size is known. */
  download(ref: StorybookRef, onProgress: (loaded: number, total?: number) => void): Promise<ArrayBuffer>;
  /** True while more Storybooks may still be published (e.g. the run is in progress). */
  mayPublishMore?(): boolean;
}

/** What viewer.html receives from the tab that opened it. */
export interface PopupStorybook {
  /** The Storybook as a zip (StorybookArchive.source). */
  data: ArrayBuffer;
  name: string;
  /** Page the Storybook starts from. */
  entry?: string;
  /** Light or dark theme of the opening page, so the Storybook keeps it in its own tab. */
  scheme?: Scheme;
}

export interface ViewerOptions {
  pollIntervalMs?: number;
  /** Where to start: a Storybook and a page of it, for example from a link someone shared. */
  start?: Place;
  /**
   * Called when the Storybook on screen, or the page shown in it, changes. `entry` is the
   * Storybook's entry page, and `count` the number of Storybooks the run has.
   */
  onNavigate?(place: Required<Place>, entry: string, count: number): void;
}

export const FRAME_SANDBOX = [
  'allow-scripts',
  'allow-same-origin', // the service worker only serves pages of this origin
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-forms',
  'allow-modals',
  'allow-downloads',
].join(' ');

export const FRAME_ALLOW = 'clipboard-write; fullscreen';

/** How long a Storybook may take to answer from its frame before we suggest a new tab. */
const START_TIMEOUT_MS = 20_000;

export const BLOCKED_MESSAGE =
  'Your browser did not let this page start the service worker that shows the Storybook from memory. ' +
  'Browsers do that when they block storage for pages embedded from another site, as this tab is in Azure DevOps.';

export class StorybookViewer {
  private readonly picker: HTMLSelectElement;
  private readonly meta: HTMLElement;
  private readonly openButton: HTMLButtonElement;
  private readonly refreshButton: HTMLButtonElement;
  private readonly notice: HTMLElement;
  private readonly status: HTMLElement;
  private readonly frame: HTMLIFrameElement;

  private refs: StorybookRef[] = [];
  private selectedId: string | undefined;
  private host: StorybookHost | undefined;
  /** Zip and name of the Storybook on screen, handed to viewer.html tabs. */
  private current: PopupStorybook | undefined;
  /** viewer.html tabs opened from here, and the Storybook each one should show. */
  private readonly popups = new Map<Window, PopupStorybook>();
  private loadToken = 0;
  private pollTimer: number | undefined;
  private startTimer: number | undefined;
  private readonly watchTimer: number;
  /** Where the next Storybook to load should start, from `options.start` or {@link goTo}. */
  private wanted: Place | undefined;
  /** The place last reported through `options.onNavigate`. */
  private reported = '';
  private disposed = false;
  private readonly onMessage = (e: MessageEvent) => this.answerPopup(e);

  constructor(
    root: HTMLElement,
    private readonly source: StorybookSource,
    private readonly options: ViewerOptions = {},
  ) {
    root.classList.add('sbp');
    root.innerHTML = `
      <header class="sbp-toolbar">
        <select class="sbp-picker" aria-label="Storybook" hidden></select>
        <span class="sbp-meta"></span>
        <span class="sbp-actions">
          <button type="button" class="sbp-button" data-action="open" disabled>Open in new tab</button>
          <button type="button" class="sbp-button" data-action="refresh">Refresh</button>
        </span>
      </header>
      <div class="sbp-notice" role="status" hidden>
        <span class="sbp-notice-text"></span>
        <button type="button" class="sbp-notice-close" aria-label="Dismiss">×</button>
      </div>
      <main class="sbp-stage">
        <iframe class="sbp-frame" title="Storybook"></iframe>
        <div class="sbp-status" role="status"></div>
      </main>`;

    this.picker = root.querySelector('.sbp-picker')!;
    this.meta = root.querySelector('.sbp-meta')!;
    this.openButton = root.querySelector('[data-action="open"]')!;
    this.refreshButton = root.querySelector('[data-action="refresh"]')!;
    this.notice = root.querySelector('.sbp-notice')!;
    this.status = root.querySelector('.sbp-status')!;
    this.frame = root.querySelector('.sbp-frame')!;
    root.querySelector('.sbp-actions')!.append(createUpsellLink());
    this.frame.setAttribute('sandbox', FRAME_SANDBOX);
    this.frame.setAttribute('allow', FRAME_ALLOW);

    this.picker.addEventListener('change', () => this.select(this.picker.value));
    this.openButton.addEventListener('click', () => this.openInNewTab());
    this.refreshButton.addEventListener('click', () => this.refresh());
    this.frame.addEventListener('load', () => this.onFrameLoad());
    window.addEventListener('message', this.onMessage);
    root.querySelector('.sbp-notice-close')!.addEventListener('click', () => (this.notice.hidden = true));

    this.wanted = options.start;
    // Storybook changes its address with the History API, which raises no event out here.
    this.watchTimer = window.setInterval(() => this.reportPlace(), 1_000);
  }

  /** Shows a place: another Storybook of the run, another page of the one on screen, or both. */
  async goTo(place: Place): Promise<void> {
    if (this.disposed || (place.id === undefined && place.address === undefined)) return;
    const id = place.id ?? this.selectedId ?? this.refs[0]?.id;
    if (id === undefined) {
      this.wanted = place; // nothing listed yet; used when something is
      return;
    }
    if (id !== this.selectedId || !this.host) {
      if (!this.refs.some((r) => r.id === id)) return;
      this.wanted = { id, address: place.address };
      await this.select(id, true);
      return;
    }
    const url = this.urlOf(this.host, place.address);
    if (url === this.frameUrl()) return;
    this.frame.src = url;
  }

  /** (Re)load the list of Storybooks and show the selected one. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    window.clearTimeout(this.pollTimer);
    this.setStatus('Looking for published Storybooks…', 'busy');
    try {
      this.refs = await this.source.list();
      if (this.disposed) return;
    } catch (err) {
      if (this.disposed) return;
      this.setStatus(`Could not list the published Storybooks. ${describe(err)}`, 'error');
      return;
    }

    if (this.refs.length === 0) {
      this.renderPicker();
      this.unload();
      if (this.source.mayPublishMore?.()) {
        this.setStatus(
          'No Storybook has been published yet. This page checks again automatically while the run is in progress.',
          'busy',
        );
        this.pollTimer = window.setTimeout(() => this.refresh(), this.options.pollIntervalMs ?? 15_000);
      } else {
        this.setStatus(
          'No Storybook was found for this run. An older run may have lost its artifacts to the retention ' +
            `settings of the project. Otherwise, add the “${TASK_NAME}” task after the step that builds your ` +
            'Storybook (storybook build).',
          'empty',
        );
      }
      return;
    }

    const keep =
      this.refs.find((r) => r.id === this.selectedId) ?? this.refs.find((r) => r.id === this.wanted?.id);
    this.renderPicker();
    await this.select((keep ?? this.refs[0]).id, true);

    if (this.disposed) return;
    if (this.source.mayPublishMore?.()) {
      // Pick up Storybooks from jobs that have not finished yet, without disturbing the current view.
      this.pollTimer = window.setTimeout(() => this.pollForNewStorybooks(), this.options.pollIntervalMs ?? 15_000);
    }
  }

  /** Stops polling, drops pending loads and stops serving the Storybook. */
  dispose(): void {
    this.disposed = true;
    this.loadToken++;
    window.clearTimeout(this.pollTimer);
    window.clearTimeout(this.startTimer);
    window.clearInterval(this.watchTimer);
    window.removeEventListener('message', this.onMessage);
    this.unload();
  }

  private async pollForNewStorybooks(): Promise<void> {
    if (this.disposed) return;
    try {
      const refs = await this.source.list();
      if (refs.length !== this.refs.length) {
        this.refs = refs;
        this.renderPicker();
      }
    } catch {
      // transient; try again next time
    }
    if (!this.disposed && this.source.mayPublishMore?.()) {
      this.pollTimer = window.setTimeout(() => this.pollForNewStorybooks(), this.options.pollIntervalMs ?? 15_000);
    }
  }

  private renderPicker(): void {
    this.picker.replaceChildren(
      ...this.refs.map((r) => {
        const o = document.createElement('option');
        o.value = r.id;
        o.textContent = r.label;
        return o;
      }),
    );
    this.picker.hidden = this.refs.length < 2;
    if (this.selectedId) this.picker.value = this.selectedId;
  }

  private async select(id: string, force = false): Promise<void> {
    if (id === this.selectedId && this.host && !force) return;
    const ref = this.refs.find((r) => r.id === id);
    if (!ref) return;
    // Start where a link pointed. A Storybook that is loaded again (Refresh) stays on its page;
    // one picked from the list starts from its entry page.
    const address = this.wanted
      ? this.wanted.id === undefined || this.wanted.id === id
        ? this.wanted.address
        : undefined
      : id === this.selectedId
        ? this.currentAddress()
        : undefined;
    this.wanted = undefined;
    this.selectedId = id;
    this.picker.value = id;
    const token = ++this.loadToken;

    this.unload();
    this.notice.hidden = true;
    this.showDetails(ref);
    this.setStatus('Downloading Storybook…', 'busy');

    let archive: StorybookArchive;
    try {
      const data = await this.source.download(ref, (loaded, total) => {
        if (token !== this.loadToken) return;
        const progress = total ? `${formatBytes(Math.min(loaded, total))} of ${formatBytes(total)}` : formatBytes(loaded);
        this.setStatus(`Downloading Storybook… ${progress}`, 'busy');
      });
      if (token !== this.loadToken) return;
      this.setStatus('Opening Storybook…', 'busy');
      archive = await loadArchive(data, { entry: ref.info?.entry, archive: ref.info?.archive });
      if (token !== this.loadToken) return;
      // From here on a new tab can show the Storybook, even if this page cannot.
      this.current = { data: archive.source, name: ref.label, entry: archive.entry };
      this.openButton.disabled = false;
    } catch (err) {
      if (token !== this.loadToken) return;
      this.setStatus(`Could not open the Storybook. ${describe(err)}`, 'error');
      return;
    }

    void archive.details().then((details) => {
      if (token === this.loadToken) this.showDetails(ref, details, archive);
    });
    if (!archive.looksLikeStorybook) {
      this.showNotice(
        'This artifact has no iframe.html, so it does not look like a Storybook build. Showing its index.html as is.',
      );
    }

    try {
      await ensureServiceWorker();
    } catch (err) {
      if (token !== this.loadToken) return;
      this.showBlocked(err instanceof ServiceWorkerUnavailable ? err.reason : describe(err));
      return;
    }
    if (token !== this.loadToken) return;

    this.host = new StorybookHost(archive, {
      onNotice: (m) => this.showNotice(m),
      onOpenPage: (address) => this.openInNewTab(address),
      onReady: () => window.clearTimeout(this.startTimer),
    });
    this.setStatus('Starting Storybook…', 'busy');
    // The first page of the Storybook reports in as soon as the service worker serves it.
    this.startTimer = window.setTimeout(() => {
      if (token === this.loadToken) this.showBlocked('The Storybook did not start.');
    }, START_TIMEOUT_MS);
    this.frame.src = this.urlOf(this.host, address);
  }

  /** URL of an address inside the Storybook; its entry page when the address is missing or leads elsewhere. */
  private urlOf(host: StorybookHost, address: string | undefined): string {
    if (address) {
      try {
        const url = new URL(host.urlOf(address)).href;
        if (url.startsWith(host.baseUrl)) return url;
      } catch {
        // not an address
      }
    }
    return host.entryUrl;
  }

  private frameUrl(): string | undefined {
    try {
      return this.frame.contentWindow?.location.href;
    } catch {
      return undefined; // the frame shows another site
    }
  }

  /** Address of the page on screen, inside the Storybook. */
  private currentAddress(): string | undefined {
    return this.host?.addressOf(this.frameUrl() ?? '');
  }

  /** Tells `options.onNavigate` where we are, when that changed. */
  private reportPlace(): void {
    if (!this.options.onNavigate || !this.host || !this.selectedId || !this.status.hidden) return;
    const address = this.currentAddress();
    if (address === undefined) return;
    const key = `${this.selectedId}\n${address}`;
    if (key === this.reported) return;
    this.reported = key;
    this.options.onNavigate({ id: this.selectedId, address }, this.host.archive.entry, this.refs.length);
  }

  /** The frame finished loading a page: show it if it is the Storybook, explain if it is not. */
  private onFrameLoad(): void {
    if (!this.host) return;
    let session: unknown;
    try {
      const page = this.frame.contentWindow as any;
      // An emptied frame loads about:blank; that is not a page of the Storybook.
      if (!page || !String(page.location.href).startsWith(this.host.baseUrl)) return;
      session = page[SESSION_MARK];
    } catch {
      return; // the Storybook navigated its frame to another site; leave it alone
    }
    window.clearTimeout(this.startTimer);
    if (session === this.host.session) {
      this.status.hidden = true;
      } else if (!this.status.hidden) {
      // The page came from the network instead of the service worker.
      this.showBlocked('The service worker did not answer for the Storybook.');
    }
  }

  /** Empties the frame and stops serving the Storybook that was in it. */
  private unload(): void {
    window.clearTimeout(this.startTimer);
    this.host?.dispose();
    this.host = undefined;
    this.current = undefined;
    this.openButton.disabled = true;
    if (this.frame.getAttribute('src')) this.frame.removeAttribute('src');
  }

  private showDetails(ref: StorybookRef, details: StorybookDetails = {}, archive?: StorybookArchive): void {
    const info = ref.info;
    const stories = details.storyCount ?? info?.storyCount;
    const version = details.storybookVersion ?? info?.storybookVersion;
    const files = archive?.fileCount ?? info?.fileCount;
    const parts = [
      this.refs.length < 2 ? ref.label : '',
      stories !== undefined ? `${stories} ${stories === 1 ? 'story' : 'stories'}` : '',
      version ? `Storybook ${version}` : '',
      files !== undefined ? `${files} files` : '',
      info?.publishedAt && !Number.isNaN(Date.parse(info.publishedAt))
        ? `published ${new Date(info.publishedAt).toLocaleString()}`
        : '',
    ].filter(Boolean);
    this.meta.textContent = parts.join(' · ');
    this.meta.title = this.meta.textContent;
  }

  /**
   * Opens the Storybook in a new browser tab. The tab is viewer.html, a real page of this
   * extension: a browser tab of its own is a different context from the tab embedded in
   * Azure DevOps, with none of this page's memory and its own service worker. viewer.html
   * asks us for the zip and serves it itself.
   */
  private openInNewTab(address?: string): void {
    if (!this.current) return;
    // Keep the story the user is looking at.
    address ??= this.currentAddress();
    const url = new URL('viewer.html', location.href);
    url.hash = new URLSearchParams({ at: address ?? '' }).toString();

    for (const w of this.popups.keys()) if (w.closed) this.popups.delete(w);
    const popup = window.open(url.href, '_blank');
    if (!popup) {
      this.showNotice('The browser blocked the new tab. Allow pop-ups for this site and try again.');
      return;
    }
    this.popups.set(popup, this.current);
  }

  /** viewer.html announces itself (also after a reload); send it the Storybook it was opened for. */
  private answerPopup(e: MessageEvent): void {
    if (e.data?.type !== 'sbp-ready') return;
    const storybook = this.popups.get(e.source as Window);
    if (!storybook) return;
    (e.source as Window).postMessage(
      { type: 'sbp-storybook', ...storybook, scheme: currentScheme() },
      e.origin === 'null' ? '*' : e.origin,
    );
  }

  private setStatus(text: string, kind: 'busy' | 'empty' | 'error'): void {
    this.status.replaceChildren(text);
    this.status.dataset.kind = kind;
    this.status.hidden = false;
  }

  /** The Storybook was downloaded but cannot be shown in this page: offer a tab of its own. */
  private showBlocked(reason: string): void {
    window.clearTimeout(this.startTimer);
    this.host?.dispose();
    this.host = undefined;
    if (this.frame.getAttribute('src')) this.frame.removeAttribute('src');

    const text = document.createElement('p');
    text.textContent = `${BLOCKED_MESSAGE} Open the Storybook in a tab of its own instead.`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sbp-button sbp-button-primary';
    button.textContent = 'Open in new tab';
    button.addEventListener('click', () => this.openInNewTab());
    const detail = document.createElement('p');
    detail.className = 'sbp-status-detail';
    detail.textContent = reason;

    this.status.replaceChildren(text, button, detail);
    this.status.dataset.kind = 'blocked';
    this.status.hidden = false;
  }

  private showNotice(message: string): void {
    this.notice.querySelector('.sbp-notice-text')!.textContent = message;
    this.notice.hidden = false;
  }
}

export function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Read a fetch response body while reporting progress. */
export async function readWithProgress(
  response: Response,
  onProgress: (loaded: number, total?: number) => void,
): Promise<ArrayBuffer> {
  const total = Number(response.headers.get('content-length')) || undefined;
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
}
