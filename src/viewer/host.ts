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

import {
  BRIDGE_PATH,
  FETCH_MESSAGE,
  VIRTUAL_FOLDER,
  channelName,
  type BridgeMessage,
  type FetchAnswer,
  type FetchQuestion,
} from '../shared/protocol';
import type { StorybookArchive } from './archive';
import { isHtml } from './mime';

export interface StorybookHostEvents {
  /** Something the user should know about. */
  onNotice?(message: string): void;
  /**
   * A page of the Storybook asked to show `address` in a new browser tab ("Open canvas in new
   * tab", a Ctrl-click in the sidebar). `address` is relative to the Storybook's folder and
   * keeps its query and fragment, e.g. `iframe.html?id=button--primary&viewMode=story`.
   * A new tab is a different context for the browser, with its own service worker and none of
   * this page's memory, so the embedding UI has to take the Storybook there itself.
   */
  onOpenPage?(address: string): void;
  /** A page of the Storybook started. The Storybook is being served. */
  onReady?(address: string): void;
}

/** The Storybooks this page serves, by session. One listener answers the service worker for all. */
const hosts = new Map<string, StorybookHost>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const question = e.data as FetchQuestion | undefined;
    const port = e.ports[0];
    if (question?.type !== FETCH_MESSAGE || !port) return;
    const host = hosts.get(question.session);
    if (!host) {
      // Not ours: the worker asks every page, another one may hold this session.
      port.postMessage({ status: 0 } satisfies FetchAnswer);
      return;
    }
    host.answer(String(question.path ?? '')).then(
      (answer) => port.postMessage(answer),
      () => port.postMessage({ status: 500 } satisfies FetchAnswer),
    );
  });
  navigator.serviceWorker.startMessages();
}

/**
 * Serves one in-memory Storybook to the service worker (see src/sw/sw.ts), which turns it
 * into the folder of URLs below {@link baseUrl}. The Storybook lives as long as this object:
 * after {@link dispose} its URLs answer 404.
 */
export class StorybookHost {
  readonly session = newSession();
  /** Address of the Storybook's folder, with a trailing slash. */
  readonly baseUrl: string;
  private readonly channel: BroadcastChannel;
  private readonly pages = new Map<string, Promise<Blob>>();
  private readonly bridgeTag: string;
  private toldAboutServiceWorker = false;
  private disposed = false;

  constructor(
    readonly archive: StorybookArchive,
    private readonly events: StorybookHostEvents = {},
  ) {
    this.baseUrl = new URL(`${VIRTUAL_FOLDER}${this.session}/`, location.href).href;
    const bridge = new URL(BRIDGE_PATH, location.href).href;
    this.bridgeTag =
      `<script src="${attribute(bridge)}" data-sbp-session="${this.session}" ` +
      `data-sbp-base="${attribute(this.baseUrl)}"></script>`;

    hosts.set(this.session, this);
    listen();
    this.channel = new BroadcastChannel(channelName(this.session));
    this.channel.onmessage = (e) => this.onBridgeMessage(e.data as BridgeMessage);
  }

  /** Address of the page the Storybook starts from. */
  get entryUrl(): string {
    return this.urlOf(this.archive.entry.split('/').map(encodeURIComponent).join('/'));
  }

  /** Full URL of an address inside the Storybook (see {@link StorybookHostEvents.onOpenPage}). */
  urlOf(address: string): string {
    return this.baseUrl + address.replace(/^\/+/, '');
  }

  /** The address inside the Storybook that `url` points to, if it points into it. */
  addressOf(url: string): string | undefined {
    return url.startsWith(this.baseUrl) ? url.slice(this.baseUrl.length) : undefined;
  }

  /** Answers the service worker's question for a file of this Storybook. */
  async answer(path: string): Promise<FetchAnswer> {
    if (this.disposed) return { status: 404 };
    // The folder itself, like a web server's directory index.
    if (path === '' || path.endsWith('/')) path += 'index.html';

    const file = this.archive.read(path);
    if (!file) return { status: 404 };
    if (!isHtml(path)) {
      const body = await file;
      return { status: 200, type: body.type, body };
    }

    let page = this.pages.get(path);
    if (!page) {
      page = file.then(async (blob) => new Blob([injectAtTop(await blob.text(), this.bridgeTag)], { type: blob.type }));
      page.catch(() => this.pages.delete(path));
      this.pages.set(path, page);
    }
    const body = await page;
    return { status: 200, type: body.type, body };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    hosts.delete(this.session);
    this.channel.close();
    this.pages.clear();
  }

  private onBridgeMessage(message: BridgeMessage | undefined): void {
    if (this.disposed || !message) return;
    switch (message.type) {
      case 'ready': {
        const address = this.addressOf(String(message.url));
        if (address !== undefined) this.events.onReady?.(address);
        return;
      }
      case 'open': {
        const address = this.addressOf(String(message.url));
        if (address === undefined) return;
        if (this.events.onOpenPage) this.events.onOpenPage(address);
        else if (!window.open(this.urlOf(address), '_blank')) {
          this.events.onNotice?.('The browser blocked the new tab. Allow pop-ups for this site and try again.');
        }
        return;
      }
      case 'service-worker-refused': {
        if (this.toldAboutServiceWorker) return;
        this.toldAboutServiceWorker = true;
        const script = String(message.script).split(/[?#]/)[0].split('/').pop() || 'a script';
        this.events.onNotice?.(
          `This Storybook tried to start a service worker of its own (${script}). That is not possible for a ` +
            'Storybook shown from a pipeline run, so stories that depend on it, such as stories that mock ' +
            'requests with Mock Service Worker, may not load.',
        );
        return;
      }
    }
  }
}

/** Unguessable, URL-safe id of a Storybook held by this page. */
function newSession(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Insert `snippet` so it runs before any script of the page. */
function injectAtTop(html: string, snippet: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + snippet + html.slice(head.index + head[0].length);
  const htmlTag = /<html(\s[^>]*)?>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + `<head>${snippet}</head>` + html.slice(at);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return html.slice(0, at) + snippet + html.slice(at);
}
