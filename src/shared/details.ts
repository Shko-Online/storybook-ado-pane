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

/** What a Storybook build says about itself, as far as it does. */
export interface StorybookDetails {
  storybookVersion?: string;
  /** For example `@storybook/react-vite`. */
  framework?: string;
  storyCount?: number;
  docsCount?: number;
}

/**
 * Reads {@link StorybookDetails} from the two files a Storybook build writes next to its pages:
 * `project.json` (version and framework) and its index, `index.json` since Storybook 7 and
 * `stories.json` before that. Either may be missing or of an unknown shape.
 */
export function describeStorybook(project: unknown, index: unknown): StorybookDetails {
  const details: StorybookDetails = {};

  const p = (project ?? {}) as {
    storybookVersion?: unknown;
    framework?: unknown;
    storybookPackages?: Record<string, { version?: unknown } | undefined>;
  };
  if (typeof p.framework === 'string') details.framework = p.framework;
  else if (typeof (p.framework as { name?: unknown } | undefined)?.name === 'string') {
    details.framework = (p.framework as { name: string }).name;
  }
  // Storybook 9 and later say their version outright; 7 and 8 only list their packages.
  const packages = p.storybookPackages && typeof p.storybookPackages === 'object' ? p.storybookPackages : {};
  const version = [p.storybookVersion, packages.storybook?.version, packages[details.framework ?? '']?.version].find(
    (v): v is string => typeof v === 'string' && v !== '',
  );
  if (version) details.storybookVersion = version;

  const i = (index ?? {}) as { entries?: unknown; stories?: unknown };
  const entries = i.entries ?? i.stories;
  if (entries && typeof entries === 'object') {
    const all = Object.values(entries) as Array<{ type?: string; parameters?: { docsOnly?: boolean } } | undefined>;
    details.docsCount = all.filter((e) => e?.type === 'docs' || e?.parameters?.docsOnly === true).length;
    details.storyCount = all.length - details.docsCount;
  }
  return details;
}
