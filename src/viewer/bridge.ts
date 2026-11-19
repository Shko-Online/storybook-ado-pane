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
 * sb/bridge.js: added at the top of every HTML page of a Storybook (see StorybookHost).
 *
 * The Storybook itself needs no help: its pages, modules and data load from ordinary URLs,
 * answered by the service worker. The bridge only looks after the places where a Storybook
 * leaves its folder, which a Storybook kept in the memory of another page cannot do alone:
 *
 *  - links and `window.open` calls that show a page of the Storybook in a new browser tab;
 *  - links to other sites, which would otherwise replace the Storybook inside its frame;
 *  - a service worker of the Storybook's own (Mock Service Worker), which cannot start here.
 */
import { SESSION_MARK, channelName, type BridgeMessage } from '../shared/protocol';

(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  const session = script?.dataset.sbpSession;
  const base = script?.dataset.sbpBase;
  const w = window as any;
  if (!session || !base || w[SESSION_MARK]) return;
  w[SESSION_MARK] = session;

  const channel = new BroadcastChannel(channelName(session));
  const send = (message: BridgeMessage) => channel.postMessage(message);
  send({ type: 'ready', url: location.href });

  const inside = (url: string) => url.startsWith(base);
  const resolve = (href: unknown): string | null => {
    try {
      return new URL(String(href), document.baseURI).href;
    } catch {
      return null;
    }
  };

  /** The outermost window that shows this Storybook: its manager, or this page when shown alone. */
  const storybookTop = (): Window => {
    let top: Window = window;
    try {
      while (top.parent !== top && inside(String(top.parent.location.href))) top = top.parent;
    } catch {
      // The parent belongs to another site: this is the top of the Storybook.
    }
    return top;
  };

  const onClick = (e: MouseEvent) => {
    if (e.button > 1) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.hasAttribute('download')) return;
    const url = resolve(a.getAttribute('href'));
    if (!url || !/^https?:/i.test(url)) return;

    const target = (a.getAttribute('target') || '').toLowerCase();
    const newTab = target === '_blank' || e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey;

    if (!inside(url)) {
      // Another site. Most refuse to be shown in a frame, so never load them in this one.
      if (!newTab) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
      return;
    }
    if (newTab) {
      e.preventDefault();
      e.stopImmediatePropagation();
      send({ type: 'open', url });
    } else if (target === '_top' || target === '_parent') {
      // Meant for the Storybook's own window, not for the page it is embedded in.
      e.preventDefault();
      e.stopImmediatePropagation();
      storybookTop().location.assign(url);
    }
  };
  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);

  const nativeOpen = window.open;
  window.open = function (this: unknown, url?: string | URL, target?: string, features?: string): Window | null {
    const resolved = url === undefined || url === null || url === '' ? null : resolve(url);
    if (resolved && inside(resolved) && (!target || target === '_blank')) {
      send({ type: 'open', url: resolved });
      return null;
    }
    return nativeOpen.call(window, url as string, target, features);
  };

  try {
    const container = navigator.serviceWorker;
    const nativeRegister = container.register.bind(container);
    container.register = ((scriptURL: string | URL, options?: RegistrationOptions) =>
      nativeRegister(scriptURL, options).catch((err: unknown) => {
        send({ type: 'service-worker-refused', script: String(scriptURL) });
        throw err;
      })) as typeof container.register;
  } catch {
    // No service workers in this context: nothing to explain.
  }
})();
