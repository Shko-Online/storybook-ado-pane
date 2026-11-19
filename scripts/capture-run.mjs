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

// Takes the pipeline run the demo recreates (the Storybook, see stories/) from Azure DevOps.
//
//   node scripts/capture-run.mjs --org <organization> --project <project> --build <build id>
//
// It reads the run from the REST API (build, timeline, artifacts, the logs of the steps that
// ran this extension's task, the pipeline's YAML file) and writes:
//   stories/demo/run.json              what the demo page shows about the run
//   stories/assets/runs/<number>/      the Storybooks the run published: each artifact as a
//                                      zip, the way the tab downloads it
// What is taken, and that nobody's name is, is decided in stories/demo/capture.ts.
//
// Authentication is your own Azure CLI login (`az login`). Both outputs are committed and
// published with the demo, so look at the diff before you commit it.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accessToken } from './azure.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const org = option('--org') ?? process.env.AZURE_DEVOPS_ORG;
const project = option('--project') ?? process.env.AZURE_DEVOPS_PROJECT;
const buildId = Number(option('--build'));

const runJson = path.join(root, 'stories', 'demo', 'run.json');
const runsDir = path.join(root, 'stories', 'assets', 'runs');

/** The shaping of the run and the viewer's own reading of an artifact are TypeScript: bundle them. */
async function loadTypeScript() {
  const outfile = path.join(root, 'build', 'capture', 'capture.mjs');
  await esbuild.build({
    stdin: {
      contents: [
        `export { captureRun } from './stories/demo/capture';`,
        `export { readStorybookInfo } from './src/shared/constants';`,
        `export { loadArchive } from './src/viewer/archive';`,
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
    // jszip is CommonJS and asks for Node's built-in modules with require().
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  if (!org || !project || !Number.isInteger(buildId) || buildId <= 0) {
    throw new Error('Usage: node scripts/capture-run.mjs --org <organization> --project <project> --build <build id>');
  }
  const { captureRun, readStorybookInfo, loadArchive } = await loadTypeScript();
  const token = accessToken();
  const api = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis`;

  const get = async (url, accept = 'application/json') => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
    // Without access Azure DevOps answers 203 with its sign-in page.
    if (res.status !== 200) throw new Error(`${res.status} ${res.statusText} for ${url.split('?')[0]}`);
    return res;
  };
  const json = async (url) => (await get(url)).json();

  const build = await json(`${api}/build/builds/${buildId}?api-version=7.1`);
  if (build.status !== 'completed') throw new Error(`Run ${build.buildNumber} has not finished yet (${build.status}).`);
  console.log(`Run #${build.buildNumber} of "${build.definition?.name}" (build ${build.id}, ${build.result})`);

  const [timeline, artifactList, definition] = await Promise.all([
    json(`${api}/build/builds/${buildId}/timeline?api-version=7.1`),
    json(`${api}/build/builds/${buildId}/artifacts?api-version=7.1`),
    json(`${api}/build/definitions/${build.definition.id}?revision=${build.definition.revision}&api-version=7.1`),
  ]);
  const records = timeline.records ?? [];
  const artifacts = artifactList.value ?? [];

  const pipelineFile = definition.process?.yamlFilename;
  if (!pipelineFile) throw new Error('The pipeline of this run is not a YAML pipeline.');
  if (build.repository?.type !== 'TfsGit') {
    throw new Error(`The repository of this run is ${build.repository?.type}; only Azure Repos is supported.`);
  }
  const repository = `${api}/git/repositories/${build.repository.id}`;
  const atCommit = `versionDescriptor.version=${build.sourceVersion}&versionDescriptor.versionType=commit`;
  const [commit, pipelineYaml] = await Promise.all([
    json(`${repository}/commits/${build.sourceVersion}?api-version=7.1`),
    get(`${repository}/items?path=${encodeURIComponent(`/${pipelineFile}`)}&${atCommit}&api-version=7.1`, 'text/plain').then(
      (res) => res.text(),
    ),
  ]);

  // The extension's task: as the Marketplace has it, and as the private dev build has it.
  const task = (file) => JSON.parse(fs.readFileSync(path.join(root, 'tasks', 'PublishStorybook', file), 'utf8'));
  const marketplaceTask = { id: task('task.json').id, name: task('task.json').name };
  const otherTasks = [{ id: task('task.dev.json').id, name: task('task.dev.json').name }];
  const ours = new Set([marketplaceTask, ...otherTasks].map((t) => t.id.toLowerCase()));

  const logs = {};
  for (const record of records) {
    if (record.type !== 'Task' || !ours.has(String(record.task?.id).toLowerCase()) || !record.log?.id) continue;
    logs[record.id] = await (await get(`${api}/build/builds/${buildId}/logs/${record.log.id}?api-version=7.1`, 'text/plain')).text();
  }

  const run = captureRun({
    organization: org,
    project,
    build,
    records,
    artifacts,
    commitMessage: commit.comment ?? '',
    pipelineFile,
    pipelineYaml,
    logs,
    marketplaceTask,
    otherTasks,
  });

  const storybooks = run.artifacts.filter((a) => a.file);
  if (storybooks.length === 0) throw new Error('This run published no Storybook with the task of this extension.');

  // The artifacts, downloaded the way the tab does it.
  const files = [];
  for (const artifact of storybooks) {
    const url = artifacts.find((a) => a.name === artifact.name)?.resource?.downloadUrl;
    if (!url) throw new Error(`The artifact ${artifact.name} has no download address.`);
    const bytes = Buffer.from(await (await get(url, 'application/zip')).arrayBuffer());

    // Open it as the tab would, so the demo cannot ship something the tab does not show.
    const info = readStorybookInfo(artifact.name, artifact.properties);
    const archive = await loadArchive(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
      entry: info.entry,
      archive: info.archive,
    });
    const details = await archive.details();
    const stories = details.storyCount !== undefined ? `, ${details.storyCount} stories` : '';
    console.log(
      `  ${artifact.file}  ${(bytes.length / 1024).toFixed(0)} KB  "${info.title}": ${archive.fileCount} files${stories}` +
        (archive.looksLikeStorybook ? '' : '  (no iframe.html)'),
    );
    files.push({ name: artifact.file, bytes });
  }

  // Only this run's artifacts are kept.
  const assets = path.join(runsDir, run.buildNumber);
  fs.rmSync(runsDir, { recursive: true, force: true });
  fs.mkdirSync(assets, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(assets, file.name), file.bytes);
  fs.writeFileSync(runJson, JSON.stringify(run, null, 2) + '\n');
  console.log(`Wrote ${path.relative(root, runJson)} and ${path.relative(root, assets)}/`);
  console.log('Both are published with the demo: look at the diff before you commit it.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
