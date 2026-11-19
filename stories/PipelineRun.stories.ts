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

import type { Meta, StoryObj } from '@storybook/html-vite';
import { useGlobals } from 'storybook/preview-api';
import { createRunPage, type RunPageOptions } from './demo/run-page';

type Args = Omit<RunPageOptions, 'onToggleTheme'>;

/** The page on screen, kept across re-renders so a theme change keeps the open tab and Storybook. */
let current: { key: string; page: HTMLElement } | undefined;
let setTheme: (theme: 'light' | 'dark') => void = () => {};

/**
 * A pipeline run of the sample project (stories/demo/run-data.ts), with the extension's
 * **Storybook** tab running on the Storybooks that run published. The rest of the page is a
 * lightweight stand-in for the Azure DevOps run page.
 */
const meta: Meta<Args> = {
  title: 'Demo/Pipeline run',
  render: (args) => {
    // The top bar's theme button sets the same global as the toolbar's theme switch.
    const [, updateGlobals] = useGlobals();
    setTheme = (theme) => updateGlobals({ theme });

    // Changing a global re-renders the story; returning the same element keeps its state.
    // A new page is built when the args change, or when the story is shown again (the
    // previous page was removed, and its viewer disposed, when another story was shown).
    const key = JSON.stringify(args);
    if (current?.key !== key || !current.page.isConnected) {
      current = {
        key,
        page: createRunPage({
          ...args,
          onToggleTheme: () => setTheme(document.documentElement.dataset.adoTheme === 'dark' ? 'light' : 'dark'),
        }),
      };
    }
    return current.page;
  },
  args: { tab: 'storybook', demoBanner: true },
  argTypes: {
    tab: { control: 'inline-radio', options: ['summary', 'storybook'], description: 'Tab shown first' },
    demoBanner: { description: 'Show the strip that explains this page is a demo' },
  },
};

export default meta;

/**
 * The export's name is the address of the demo (`?id=demo-pipeline-run--sample-run`), which the
 * README and the Marketplace page link to. It stays the same when another run is captured.
 */
export const SampleRun: StoryObj<Args> = { name: 'Sample run' };
