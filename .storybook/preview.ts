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

import type { Preview } from '@storybook/html-vite';
import '../src/tab/tab.css';
import '../stories/demo/run-page.css';

type Theme = 'auto' | 'light' | 'dark';

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let theme: Theme = 'auto';

/**
 * Azure DevOps themes the extension's frame, and the tab marks its page light or dark from
 * that (src/viewer/theme.ts). Here the run page and the tab share one page, marked the same way.
 */
function applyTheme(next: Theme): void {
  theme = next;
  const dark = theme === 'dark' || (theme === 'auto' && systemDark.matches);
  document.documentElement.dataset.adoTheme = dark ? 'dark' : 'light';
}
systemDark.addEventListener('change', () => applyTheme(theme));

// While developing: the viewer keeps state for the whole page (the listener that answers its
// service worker). Modules swapped into the running page would leave the old one answering,
// so an edit loads the page again instead.
if (import.meta.hot) import.meta.hot.on('vite:beforeUpdate', () => window.location.reload());

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    options: { storySort: { order: ['Demo', 'Components'] } },
  },
  globalTypes: {
    theme: {
      description: 'Azure DevOps theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'auto', title: 'Follow system' },
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'auto' },
  decorators: [
    (story, context) => {
      applyTheme(context.globals.theme as Theme);
      return story();
    },
  ],
};

export default preview;
