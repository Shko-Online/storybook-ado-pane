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

import { SERVICE_WORKER_PATH } from '../shared/protocol';

/**
 * The browser does not let this page run the service worker that serves Storybooks. Inside
 * Azure DevOps the page is embedded from another site, and some browsers and privacy settings
 * do not allow service workers there. A page in its own browser tab is usually allowed.
 */
export class ServiceWorkerUnavailable extends Error {
  constructor(readonly reason: string) {
    super(`The browser did not start the service worker. ${reason}`);
    this.name = 'ServiceWorkerUnavailable';
  }
}

let ready: Promise<void> | undefined;

/**
 * Starts the service worker (sb/sw.js, next to this page) if it is not running yet, and
 * resolves once it answers requests. Rejects with {@link ServiceWorkerUnavailable}.
 */
export function ensureServiceWorker(timeoutMs = 20_000): Promise<void> {
  ready ??= start(timeoutMs).catch((err) => {
    ready = undefined; // let a later attempt try again
    throw err;
  });
  return ready;
}

async function start(timeoutMs: number): Promise<void> {
  let container: ServiceWorkerContainer | undefined;
  try {
    container = navigator.serviceWorker;
  } catch (err) {
    throw new ServiceWorkerUnavailable(describe(err));
  }
  if (!container) throw new ServiceWorkerUnavailable('Service workers are not available in this browser or window.');

  const script = new URL(SERVICE_WORKER_PATH, location.href);
  let registration: ServiceWorkerRegistration;
  try {
    // The default scope is the folder of the script (sb/), which this page is not part of:
    // the worker never sees the requests this page makes to Azure DevOps.
    registration = await container.register(script.href);
  } catch (err) {
    throw new ServiceWorkerUnavailable(describe(err));
  }
  dropOlderVersions(container, registration);
  await activated(registration, timeoutMs);
}

function activated(registration: ServiceWorkerRegistration, timeoutMs: number): Promise<void> {
  if (registration.active?.state === 'activated') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new ServiceWorkerUnavailable('It did not start in time.')),
      timeoutMs,
    );
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const check = () => {
        if (worker.state === 'activated') {
          window.clearTimeout(timer);
          resolve();
        } else if (worker.state === 'redundant' && !registration.active) {
          window.clearTimeout(timer);
          reject(new ServiceWorkerUnavailable('It failed to install.'));
        }
      };
      worker.addEventListener('statechange', check);
      check();
    };
    watch(registration.installing);
    watch(registration.waiting);
    watch(registration.active);
    registration.addEventListener('updatefound', () => watch(registration.installing));
  });
}

/**
 * Every version of the extension is served from its own folder, so each update leaves the
 * worker of the previous version registered for a folder nobody opens again. Remove those.
 * Only registrations of this same extension are touched: the address is
 * `…/extensions/<publisher>/<extension>/<version>/…`, and other extensions share the origin.
 */
function dropOlderVersions(container: ServiceWorkerContainer, current: ServiceWorkerRegistration): void {
  const marker = /^(.*\/extensions\/[^/]+\/[^/]+\/)/.exec(new URL(current.scope).pathname)?.[1];
  if (!marker) return;
  void container
    .getRegistrations()
    .then((all) => {
      for (const r of all) {
        const path = new URL(r.scope).pathname;
        if (r.scope !== current.scope && path.startsWith(marker) && path.endsWith('/sb/')) void r.unregister();
      }
    })
    .catch(() => undefined);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
