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
 * How the pieces that show a Storybook talk to each other.
 *
 *   page (tab.html, viewer.html)      holds the unpacked Storybook in memory (StorybookHost)
 *   service worker (sb/sw.js)         gives it URLs: sb/s/<session>/<file>
 *   bridge (sb/bridge.js)             runs inside the Storybook's own pages
 *
 * All paths below are relative to the folder of the page.
 */

/** The service worker. Its scope is its own folder, so it only ever sees requests below `sb/`. */
export const SERVICE_WORKER_PATH = 'sb/sw.js';

/** Script added to every HTML page of a Storybook (see src/viewer/bridge.ts). */
export const BRIDGE_PATH = 'sb/bridge.js';

/** Folder of the virtual files. `sb/s/<session>/index.html` is the Storybook of that session. */
export const VIRTUAL_FOLDER = 'sb/s/';

/**
 * Service worker → page, with a MessagePort for the answer: "do you have this file?".
 * The worker keeps nothing itself, so the browser may stop and restart it at any time.
 */
export const FETCH_MESSAGE = 'sbp:fetch';

export interface FetchQuestion {
  type: typeof FETCH_MESSAGE;
  /** Identifies the Storybook; the page that created the session owns it. */
  session: string;
  /** File inside the Storybook, POSIX style, without a leading slash. Empty for the folder itself. */
  path: string;
}

export interface FetchAnswer {
  /** HTTP status, or 0 when the page does not own the session (another page may). */
  status: number;
  /** Content type of `body`. */
  type?: string;
  body?: Blob;
}

/** Name of the BroadcastChannel between the pages of a Storybook (bridge) and the page that hosts it. */
export const channelName = (session: string) => `sbp:${session}`;

/** Bridge → host page. */
export type BridgeMessage =
  /** A page of the Storybook started; `url` is its address. */
  | { type: 'ready'; url: string }
  /** Open `url` (an address inside the Storybook) in a new browser tab. */
  | { type: 'open'; url: string }
  /** The Storybook tried to register a service worker of its own, which cannot work here. */
  | { type: 'service-worker-refused'; script: string };

/** Property the bridge sets on the window of every Storybook page, with the session id. */
export const SESSION_MARK = '__sbpSession';
