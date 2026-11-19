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

/// <reference lib="webworker" />

/**
 * Service worker that gives an in-memory Storybook real URLs.
 *
 * A Storybook is a small web application: its pages load ES modules, fetch `index.json`, and
 * show `iframe.html` in a frame, all with relative URLs. That only works from something that
 * looks like a folder on a web server. This worker is that server for the URLs below
 * `s/<session>/`. A Storybook may also ask for a file by its absolute path (`/logo.png`), as
 * if it were the whole site; those requests are answered from the Storybook too.
 *
 * It stores nothing. Each request is passed to the page that unpacked the Storybook and still
 * holds it in memory (see src/viewer/host.ts), so the browser can stop and restart the worker
 * at any time, and nothing of a Storybook is ever written to disk.
 */
import { FETCH_MESSAGE, type FetchAnswer, type FetchQuestion } from '../shared/protocol';

declare const self: ServiceWorkerGlobalScope;

/** Path of this worker's folder, which holds the real files of the extension it works with. */
const SCOPE = new URL(self.registration.scope).pathname;

/** Path of the virtual files: `<scope>s/`. */
const VIRTUAL = `${SCOPE}s/`;

/** How long a page may take to answer. Unpacking one large file takes well under this. */
const ANSWER_TIMEOUT_MS = 30_000;

/** Session → the page that answered for it last. Only a shortcut: rebuilt when the worker restarts. */
const owners = new Map<string, string>();

self.addEventListener('install', () => {
  // Nothing to cache: take over as soon as possible.
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // What stories load from other sites goes to the network as usual.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(VIRTUAL)) {
    event.respondWith(serve(request, url).catch((err) => plain(500, `Could not serve the file. ${String(err)}`)));
    return;
  }
  // The extension's own files next to this worker (the bridge script).
  if (url.pathname.startsWith(SCOPE)) return;

  // Anything else on this origin, asked for by a page this worker controls. Only pages of a
  // Storybook are, so this is a Storybook using an absolute path, as one written for the root
  // of a site does: "/logo.png" is "logo.png" of the Storybook. Navigations have no client.
  if (!event.clientId || (request.method !== 'GET' && request.method !== 'HEAD')) return;
  event.respondWith(serveAbsolute(request, url, event.clientId));
});

/** Answers a request for a URL below `s/<session>/`. */
async function serve(request: Request, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Only GET is supported.');

  const target = parse(url.pathname);
  if (!target) {
    // "s/<session>" → "s/<session>/", so the relative URLs of the entry page resolve.
    return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 302);
  }

  const answer = await ask({ type: FETCH_MESSAGE, session: target.session, path: target.path });
  if (!answer) {
    return plain(
      404,
      'This Storybook is no longer loaded. Reopen it from the Storybook tab of the pipeline run.',
    );
  }
  if (answer.status !== 200 || !answer.body) {
    return plain(answer.status === 200 ? 500 : answer.status, `Not found in this Storybook: ${target.path}`);
  }
  return respond(request, answer.body, answer.type);
}

/** Answers a request for an absolute path from the Storybook of the page that asks, if it has the file. */
async function serveAbsolute(request: Request, url: URL, clientId: string): Promise<Response> {
  try {
    const client = await self.clients.get(clientId);
    const session = client && parse(new URL(client.url).pathname)?.session;
    const path = decode(url.pathname.slice(1));
    if (session && path) {
      const answer = await ask({ type: FETCH_MESSAGE, session, path });
      if (answer?.status === 200 && answer.body) return respond(request, answer.body, answer.type);
    }
  } catch {
    // fall through to the network
  }
  return fetch(request);
}

/** Session and file of a path below the virtual folder; undefined for `s/<session>` without a slash. */
function parse(pathname: string): { session: string; path: string } | undefined {
  if (!pathname.startsWith(VIRTUAL)) return undefined;
  const rest = pathname.slice(VIRTUAL.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return undefined;
  return { session: rest.slice(0, slash), path: decode(rest.slice(slash + 1)) };
}

function decode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function respond(request: Request, body: Blob, type: string | undefined): Response {
  const headers = new Headers({
    'Content-Type': type || body.type || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
  });

  // Media elements ask for byte ranges (Safari insists on them).
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range')?.trim() ?? '');
  if (range && (range[1] !== '' || range[2] !== '')) {
    const size = body.size;
    const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(request.method === 'HEAD' ? null : body.slice(start, end + 1), { status: 206, headers });
  }

  headers.set('Content-Length', String(body.size));
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
}

/** Finds the page that holds the session and asks it for the file. */
async function ask(question: FetchQuestion): Promise<FetchAnswer | undefined> {
  const known = owners.get(question.session);
  if (known) {
    const client = await self.clients.get(known);
    const answer = client && (await askClient(client, question));
    if (answer && answer.status !== 0) return answer;
    owners.delete(question.session);
  }

  // The pages of a Storybook never hold one: ask the others (the tab, a viewer tab).
  const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(
    (c) => !isVirtual(c.url),
  );
  if (clients.length === 0) return undefined;

  return new Promise((resolve) => {
    let pending = clients.length;
    for (const client of clients) {
      void askClient(client, question).then((answer) => {
        if (answer && answer.status !== 0) {
          owners.set(question.session, client.id);
          resolve(answer);
        } else if (--pending === 0) {
          resolve(undefined);
        }
      });
    }
  });
}

function askClient(client: Client, question: FetchQuestion): Promise<FetchAnswer | undefined> {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    const timer = setTimeout(() => done(undefined), ANSWER_TIMEOUT_MS);
    const done = (answer: FetchAnswer | undefined) => {
      clearTimeout(timer);
      port1.close();
      resolve(answer);
    };
    port1.onmessage = (e) => done(e.data as FetchAnswer);
    try {
      client.postMessage(question, [port2]);
    } catch {
      done(undefined);
    }
  });
}

function isVirtual(clientUrl: string): boolean {
  try {
    const url = new URL(clientUrl);
    return url.origin === self.location.origin && url.pathname.startsWith(VIRTUAL);
  } catch {
    return false;
  }
}

function plain(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
