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

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as tl from 'azure-pipelines-task-lib/task';
import { ARCHIVE_NAME, CONTRACT_VERSION, DEFAULT_ENTRY, PROPERTY } from '../../../src/shared/constants';
import { describeStorybook, type StorybookDetails } from '../../../src/shared/details';
import { listFolder, writeZip } from './zip';

type IfMissing = 'warn' | 'error' | 'ignore';

/** Characters Azure DevOps does not accept in the name of an artifact. */
const INVALID_IN_ARTIFACT_NAME = /[\\/":<>|*?]/;

async function run(): Promise<void> {
  const workDir = tl.getVariable('System.DefaultWorkingDirectory') || process.cwd();
  const storybookDir = path.resolve(workDir, tl.getInput('storybookDir', true)!);
  const ifMissing = (tl.getInput('ifMissing') || 'warn') as IfMissing;

  const hostType = tl.getVariable('System.HostType');
  if (hostType && hostType.toLowerCase() !== 'build') {
    // The agent only accepts artifact uploads from build pipelines (YAML pipelines are builds).
    tl.setResult(
      tl.TaskResult.Failed,
      `Storybooks can only be published from a build pipeline, not from a classic release (System.HostType is "${hostType}").`,
    );
    return;
  }

  const artifactName = (tl.getInput('artifactName') || '').trim() || 'storybook';
  if (INVALID_IN_ARTIFACT_NAME.test(artifactName)) {
    tl.setResult(
      tl.TaskResult.Failed,
      `The artifact name "${artifactName}" is not valid: it cannot contain any of \\ / " : < > | * ?`,
    );
    return;
  }

  if (!isDirectory(storybookDir)) {
    return missing(ifMissing, `Storybook folder not found: ${storybookDir}`);
  }
  const files = listFolder(storybookDir);
  if (!files.some((f) => f.path === DEFAULT_ENTRY)) {
    return missing(
      ifMissing,
      `No ${DEFAULT_ENTRY} in ${storybookDir}. Build the Storybook first (storybook build) and point storybookDir at its output folder.`,
    );
  }
  if (!files.some((f) => f.path === 'iframe.html')) {
    tl.warning(`${storybookDir} has no iframe.html, so it does not look like a Storybook build. Publishing it as it is.`);
  }

  const title = oneLine(tl.getInput('title') || '').slice(0, 100) || artifactName;
  const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f.file).size, 0);
  const details = describeStorybook(
    readJson(path.join(storybookDir, 'project.json')),
    readJson(path.join(storybookDir, 'index.json')) ?? readJson(path.join(storybookDir, 'stories.json')),
  );

  // One zip instead of the folder: Azure DevOps handles an artifact file by file, which takes
  // minutes to upload, and again to download, once a Storybook has a thousand files.
  const tempRoot = tl.getVariable('Agent.TempDirectory') || os.tmpdir();
  const archive = path.join(fs.mkdtempSync(path.join(tempRoot, 'storybook-')), ARCHIVE_NAME);
  const archiveBytes = writeZip(archive, files);

  console.log(`Storybook folder : ${storybookDir}`);
  console.log(`Storybook        : ${summary(details) || 'unknown version'}`);
  console.log(`Files            : ${files.length} (${formatBytes(totalBytes)}, ${formatBytes(archiveBytes)} zipped)`);
  console.log(`Artifact         : ${artifactName} (${ARCHIVE_NAME})`);
  console.log(`Title            : ${title}`);

  // Everything besides the two names the agent knows is kept as a property of the artifact.
  // That is how the Storybook tab tells this artifact from the other artifacts of the run.
  const properties: Record<string, string> = {
    containerfolder: artifactName,
    artifactname: artifactName,
    [PROPERTY.marker]: String(CONTRACT_VERSION),
    [PROPERTY.title]: title,
    [PROPERTY.archive]: ARCHIVE_NAME,
    [PROPERTY.entry]: DEFAULT_ENTRY,
    [PROPERTY.publishedAt]: new Date().toISOString(),
    [PROPERTY.fileCount]: String(files.length),
  };
  if (details.storybookVersion) properties[PROPERTY.storybookVersion] = oneLine(details.storybookVersion).slice(0, 50);
  if (details.framework) properties[PROPERTY.framework] = oneLine(details.framework).slice(0, 100);
  if (details.storyCount !== undefined) properties[PROPERTY.storyCount] = String(details.storyCount);
  if (details.docsCount !== undefined) properties[PROPERTY.docsCount] = String(details.docsCount);

  // The agent uploads the file after this process ends, and fails the step if that goes wrong.
  tl.command('artifact.upload', properties, archive);

  console.log('');
  console.log('Open this pipeline run and select the "Storybook" tab to browse the stories.');
  tl.setResult(tl.TaskResult.Succeeded, `Published "${title}" as the artifact "${artifactName}" (${files.length} files)`);
}

function missing(mode: IfMissing, message: string): void {
  switch (mode) {
    case 'error':
      tl.setResult(tl.TaskResult.Failed, message);
      return;
    case 'warn':
      tl.warning(message);
      tl.setResult(tl.TaskResult.SucceededWithIssues, message);
      return;
    default:
      console.log(message);
      tl.setResult(tl.TaskResult.Skipped, message);
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function summary(details: StorybookDetails): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    details.storybookVersion ? `${details.storybookVersion}${details.framework ? ` (${details.framework})` : ''}` : '',
    details.storyCount !== undefined ? plural(details.storyCount, 'story', 'stories') : '',
    details.docsCount ? plural(details.docsCount, 'docs page', 'docs pages') : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** Property values travel on one line of the task's output. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

run().catch((err: unknown) => {
  tl.setResult(tl.TaskResult.Failed, err instanceof Error ? err.message : String(err));
});
