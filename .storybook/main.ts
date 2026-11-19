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

import type { StorybookConfig } from '@storybook/html-vite';

/*
  This Storybook shows the extension itself: a recreated pipeline run with the real
  "Storybook" tab, and the tab's states. The Storybook that tab shows is another one: the
  sample project's (samples/demo), as a pipeline run published it.
*/
const config: StorybookConfig = {
  framework: '@storybook/html-vite',
  stories: ['../stories/**/*.stories.ts'],
  staticDirs: [
    // runs/<number>/*.zip: the artifacts the demo run published (see scripts/capture-run.mjs).
    { from: '../stories/assets', to: '/' },
    // What the tab needs next to its page: sb/sw.js and sb/bridge.js, which show a Storybook
    // from memory, and viewer.html for "Open in new tab" (built by
    // `node scripts/build.mjs --web-only`, see the storybook scripts).
    { from: '../build/web', to: '/' },
  ],
  core: { disableTelemetry: true },
};

export default config;
