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
 * The pipeline run the demo recreates: a real run of the sample project (samples/demo) in
 * Azure DevOps. `npm run capture-run -- --build <id>` reads it from the build, timeline,
 * artifact and log APIs and writes run.json, and next to the stories (assets/runs/<number>)
 * the artifacts that run published, as Azure DevOps hands them out.
 */
import data from './run.json';

/** How a run, a job or a step ended. */
export type Result = 'succeeded' | 'warning' | 'failed' | 'canceled' | 'skipped';

export interface Step {
  name: string;
  result: Result;
  durationMs: number;
  /** Task reference, for the steps that use this extension: `PublishStorybook@1`. */
  task?: string;
  /** What the step printed, for the steps that use this extension. */
  log?: string[];
  /** Name of the artifact the step published. */
  artifact?: string;
}

export interface Job {
  name: string;
  result: Result;
  durationMs: number;
  steps: Step[];
}

export interface Issue {
  type: 'error' | 'warning';
  /** Name of the job or step that reported it. */
  source: string;
  message: string;
}

/** A build artifact of the run. */
export interface Artifact {
  name: string;
  /**
   * The properties the tab reads, as the build API lists them: the ones the task wrote
   * (src/shared/constants.ts) and the agent's `artifactsize`.
   */
  properties: Record<string, string>;
  /** For a Storybook: the artifact as a zip, the way the tab downloads it. A file below {@link Run.assets}. */
  file?: string;
}

export interface Run {
  organization: string;
  project: string;
  pipeline: string;
  buildId: number;
  buildNumber: string;
  /** First line of the commit message, which Azure DevOps uses as the title of the run. */
  title: string;
  result: Result;
  /** Why the run started, as the run page words it: "Manually triggered". */
  reason: string;
  repository: string;
  branch: string;
  commit: string;
  started: string;
  durationMs: number;
  /** The pipeline's YAML file, in the repository. */
  pipelineFile: string;
  /** The steps of that file that publish a Storybook, as they are written there. */
  publishYaml: string;
  /** The task as pipelines call it with the extension from the Marketplace: `PublishStorybook@1`. */
  marketplaceTask: string;
  issues: Issue[];
  jobs: Job[];
  artifacts: Artifact[];
  /** Folder of the artifacts' zips, among the Storybook's static files (see .storybook/main.ts). */
  assets: string;
}

export const run = data as Run;
