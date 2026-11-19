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

import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events';
import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

/*
  Storybook's own UI follows the same "theme" global as the stories (see preview.ts):
  the system's light or dark mode by default ("auto"), or the mode picked in the toolbar
  or with the theme button in the demo's Azure DevOps top bar.
*/
const brand = {
  brandTitle: 'Storybook Viewer for Azure DevOps',
  brandUrl: 'https://github.com/Shko-Online/storybook-ado-pane',
  brandTarget: '_blank',
};
const themes = { light: create({ base: 'light', ...brand }), dark: create({ base: 'dark', ...brand }) };

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let setting = 'auto';
const current = () => themes[setting === 'dark' || (setting === 'auto' && systemDark.matches) ? 'dark' : 'light'];

addons.setConfig({
  theme: current(),
  /*
    The demo is a whole page: keep the addon panel out of its way. This is a customisation and
    not the `showPanel` option, because Storybook saves options in the browser for the site,
    and the Storybook shown inside the demo is on this same site: it would lose its panel too.
  */
  layoutCustomisations: {
    showPanel: (state, shown) => (state.storyId?.startsWith('demo-') ? false : shown),
  },
});

addons.register('storybook-ado-pane/theme', (api) => {
  const apply = (globals?: Record<string, unknown>) => {
    setting = typeof globals?.theme === 'string' ? globals.theme : 'auto';
    api.setOptions({ theme: current() });
  };
  // SET_GLOBALS: the preview's initial globals (including ?globals= from the URL).
  api.on(SET_GLOBALS, ({ globals }) => apply(globals));
  api.on(GLOBALS_UPDATED, ({ globals }) => apply(globals));
  systemDark.addEventListener('change', () => api.setOptions({ theme: current() }));
});
