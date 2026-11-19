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
 * Contract between the pipeline task (writer) and the build results tab (reader).
 *
 * The task publishes the Storybook as a build artifact (its folder, in one zip file) and
 * describes it with artifact properties, which the agent stores next to the artifact
 * (`##vso[artifact.upload …]` keeps every property it does not know). The tab lists the artifacts of a run and shows the ones
 * that carry {@link PROPERTY.marker}. Bump CONTRACT_VERSION if the meaning of a property
 * changes in an incompatible way.
 */

export const CONTRACT_VERSION = 1;

/** Artifact properties written by the task. Names are lower case: the agent matches them without case. */
export const PROPERTY = {
  /** Marks the artifact as a Storybook published by the task. The value is the contract version. */
  marker: 'storybookpane',
  /** Name shown in the tab (task input `title`, or the artifact name). */
  title: 'storybooktitle',
  /**
   * Name of the zip file in the artifact that holds the Storybook. The task publishes the
   * folder as one zip, because Azure DevOps handles an artifact file by file. Without this
   * property the files of the artifact are the Storybook.
   */
  archive: 'storybookarchive',
  /** Path, in the Storybook's folder, of the page to open first. */
  entry: 'storybookentry',
  /** ISO timestamp of when the task published the artifact. */
  publishedAt: 'storybookpublished',
  /** Number of files in the Storybook folder. */
  fileCount: 'storybookfiles',
  /** Storybook version that built the folder (from its project.json), when known. */
  storybookVersion: 'storybookversion',
  /** Framework of the Storybook, e.g. `@storybook/react-vite` (from its project.json), when known. */
  framework: 'storybookframework',
  /** Number of stories in the Storybook's index, when known. */
  storyCount: 'storybookstories',
  /** Number of documentation pages in the Storybook's index, when known. */
  docsCount: 'storybookdocs',
} as const;

/** The page a Storybook build always starts from. */
export const DEFAULT_ENTRY = 'index.html';

/** Name the task gives the zip file it publishes. */
export const ARCHIVE_NAME = 'storybook.zip';

/** Type of the artifacts the task publishes (`##vso[artifact.upload]` creates file container artifacts). */
export const ARTIFACT_TYPE = 'Container';

/** What the tab knows about a published Storybook before downloading it. */
export interface StorybookInfo {
  /** Display name. */
  title: string;
  /** Path, in the Storybook's folder, of the page to open first. */
  entry: string;
  /** Name of the zip file in the artifact that holds the Storybook, when it was published as one. */
  archive?: string;
  publishedAt?: string;
  /** Number of files of the Storybook. */
  fileCount?: number;
  /** Size of what the artifact holds, in bytes (the agent's `artifactsize` property). */
  artifactBytes?: number;
  storybookVersion?: string;
  framework?: string;
  storyCount?: number;
  docsCount?: number;
}

/** Reads {@link StorybookInfo} from artifact properties; undefined when the artifact is not a Storybook. */
export function readStorybookInfo(
  artifactName: string,
  properties: Record<string, string> | undefined,
): StorybookInfo | undefined {
  if (!properties) return undefined;
  // Be lenient about the case of property names: they pass through the agent and the server.
  const props = new Map(Object.entries(properties).map(([k, v]) => [k.toLowerCase(), String(v ?? '')]));
  const marker = Number(props.get(PROPERTY.marker));
  if (!Number.isFinite(marker) || marker < 1) return undefined;

  const text = (key: string) => props.get(key)?.trim() || undefined;
  const count = (key: string) => {
    const n = Number(props.get(key));
    return props.get(key) !== undefined && props.get(key) !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  return {
    title: text(PROPERTY.title) ?? artifactName,
    entry: text(PROPERTY.entry) ?? DEFAULT_ENTRY,
    archive: text(PROPERTY.archive),
    publishedAt: text(PROPERTY.publishedAt),
    fileCount: count(PROPERTY.fileCount),
    artifactBytes: count('artifactsize'),
    storybookVersion: text(PROPERTY.storybookVersion),
    framework: text(PROPERTY.framework),
    storyCount: count(PROPERTY.storyCount),
    docsCount: count(PROPERTY.docsCount),
  };
}
