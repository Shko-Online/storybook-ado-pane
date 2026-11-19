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
import { ServiceWorkerUnavailable } from '../src/viewer/sw-client';
import type { StorybookSource, ViewerOptions } from '../src/viewer/ui';
import { run } from './demo/run-data';
import {
  BrokenArchiveSource,
  DemoRunSource,
  EmptySource,
  FailingListSource,
  PlainSiteSource,
  SlowDownloadSource,
  mountViewer,
  storybookOf,
} from './demo/sources';

/**
 * The content of the **Storybook** tab (src/viewer/ui.ts) on its own, in each of its states.
 * In Azure DevOps it reads the artifacts of the run; here it reads fixed sources.
 */
interface Args {
  source: () => StorybookSource;
  options?: ViewerOptions;
}

const meta: Meta<Args> = {
  title: 'Components/Storybook viewer',
  render: ({ source, options }) => {
    const root = document.createElement('div');
    root.style.height = '100vh';
    mountViewer(root, source(), options);
    return root;
  },
  argTypes: { source: { table: { disable: true } }, options: { table: { disable: true } } },
};

export default meta;
type Story = StoryObj<Args>;

const storybooks = run.artifacts.filter((a) => storybookOf(a));
const [first] = storybooks;

/** The demo run may have published one Storybook only: then it is shown a second time, as another app's. */
const several =
  storybooks.length > 1
    ? storybooks
    : [first, { ...first, name: `${first.name}-admin`, properties: { ...first.properties, storybooktitle: 'Admin app' } }];

/** A run with more than one Storybook: the picker switches between them. */
export const SeveralStorybooks: Story = { args: { source: () => new DemoRunSource(several) } };

/** With a single Storybook, the picker is replaced by its name. */
export const OneStorybook: Story = { args: { source: () => new DemoRunSource([first]) } };

/** The run is still in progress: the tab checks again until a Storybook appears. */
export const WaitingForStorybook: Story = { args: { source: () => new EmptySource(true) } };

/** The run finished without publishing a Storybook. */
export const NoStorybook: Story = { args: { source: () => new EmptySource(false) } };

/** A large Storybook being downloaded. */
export const Downloading: Story = { args: { source: () => new SlowDownloadSource() } };

/** The artifacts could not be listed, for example because of missing permissions. */
export const CannotListStorybooks: Story = { args: { source: () => new FailingListSource() } };

/** The download is not a zip. */
export const NotAnArchive: Story = { args: { source: () => new BrokenArchiveSource() } };

/** The artifact holds a website that Storybook did not build: it is shown as it is, with a notice. */
export const NotAStorybookBuild: Story = { args: { source: () => new PlainSiteSource() } };

/**
 * The browser does not let the tab start its service worker, as browsers that block storage
 * for embedded pages do. The Storybook is downloaded, and opens in a browser tab of its own.
 */
export const ServiceWorkerBlocked: Story = {
  args: {
    source: () => new DemoRunSource([first]),
    options: {
      startServiceWorker: () => Promise.reject(new ServiceWorkerUnavailable('The operation is insecure.')),
    },
  },
};
