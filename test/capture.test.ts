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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readStorybookInfo } from '../src/shared/constants';
import { loadArchive } from '../src/viewer/archive';
import { captureRun, taskSteps, type CaptureInput } from '../stories/demo/capture';
import type { Run } from '../stories/demo/run-data';

const MARKETPLACE_TASK = { id: '336a2210-9ff7-42c5-90a8-49f39fbeecb0', name: 'PublishStorybook' };
const DEV_TASK = { id: 'f0b8490e-ec4f-48f5-8c80-921cabf4c344', name: 'PublishStorybookDev' };

const YAML = `trigger: none

steps:
  - script: npm run build-storybook
    displayName: Build Storybook

  # Publishes the folder as a build artifact.
  - task: PublishStorybookDev@1
    displayName: Publish Storybook
    inputs:
      storybookDir: storybook-static

      title: Design system

  - task: PublishBuildArtifacts@1
    inputs:
      pathToPublish: drop
`;

/** What the REST API answers, with the parts the demo must not repeat: people, ids, addresses. */
function answers(task = DEV_TASK): CaptureInput {
  const person = { displayName: 'Some One', uniqueName: 'someone@example.com', id: 'c0ffee00-0000-4000-8000-000000000001' };
  return {
    organization: 'Contoso',
    project: 'Web',
    build: {
      id: 42,
      buildNumber: '20261119.7',
      status: 'completed',
      result: 'succeeded',
      reason: 'manual',
      sourceBranch: 'refs/heads/main',
      sourceVersion: '6bd524847e1c6d4a80f771ba72307aaba17d6346',
      startTime: '2026-11-19T19:45:05.6792087Z',
      finishTime: '2026-11-19T19:45:41.8597396Z',
      definition: { id: 56, name: 'Design system', url: 'https://dev.azure.com/contoso/_apis/build/Definitions/56' },
      repository: { id: 'e8c4d2aa-0000-4000-8000-000000000002', name: 'web', type: 'TfsGit' },
      requestedFor: person,
      requestedBy: person,
      lastChangedBy: person,
      queue: { id: 9, name: 'Azure Pipelines' },
      _links: { self: { href: 'https://dev.azure.com/contoso/_apis/build/Builds/42' } },
    } as CaptureInput['build'],
    records: [
      { id: 's', type: 'Stage', name: '__default', order: 1, result: 'succeeded' },
      {
        id: 'j',
        parentId: 'p',
        type: 'Job',
        name: 'Job',
        order: 1,
        result: 'succeeded',
        startTime: '2026-11-19T19:45:08.85Z',
        finishTime: '2026-11-19T19:45:29.19Z',
        workerName: 'Hosted Agent 7',
      } as CaptureInput['records'][number],
      // Out of order on purpose: the API does not sort them.
      {
        id: 't2',
        parentId: 'j',
        type: 'Task',
        name: 'Publish Storybook',
        order: 2,
        result: 'succeeded',
        startTime: '2026-11-19T19:45:27.13Z',
        finishTime: '2026-11-19T19:45:28.42Z',
        task: { id: task.id.toUpperCase(), name: task.name, version: '1.0.263231923' },
      },
      {
        id: 't1',
        parentId: 'j',
        type: 'Task',
        name: 'Build Storybook',
        order: 1,
        result: 'succeededWithIssues',
        startTime: '2026-11-19T19:45:23.26Z',
        finishTime: '2026-11-19T19:45:27.13Z',
        task: { id: 'd9bafed4-0b18-4f58-968d-86655b4d2ce9', name: 'CmdLine', version: '2.281.0' },
        issues: [{ type: 'warning', message: 'The ubuntu-latest label will migrate.' }],
      },
      { id: 'p', parentId: 's', type: 'Phase', name: 'Job', order: 1, result: 'succeeded' },
    ],
    artifacts: [
      {
        id: 1100,
        name: 'storybook',
        source: 'j',
        resource: {
          type: 'Container',
          data: '#/40540418/storybook',
          downloadUrl: 'https://dev.azure.com/contoso/_apis/build/builds/42/artifacts?artifactName=storybook',
          properties: {
            StorybookPane: '1',
            storybooktitle: 'Design system',
            storybookarchive: 'storybook.zip',
            storybookstories: '15',
            artifactsize: '2304192',
            localpath: '/home/runner/work/_temp/storybook-AQDYwA/storybook.zip',
          },
        },
      } as CaptureInput['artifacts'][number],
      { id: 1101, name: 'drop', resource: { properties: { artifactsize: '10', localpath: '/home/runner/work/1/a' } } },
    ],
    commitMessage: 'docs: show the Storybook tab in screenshots\n\nThree screenshots of a run.\n',
    pipelineFile: '/samples/demo/azure-pipelines.yml',
    pipelineYaml: YAML,
    logs: {
      t2: [
        '2026-11-19T19:45:27.1356309Z ##[section]Starting: Publish Storybook',
        '2026-11-19T19:45:27.4522864Z Artifact         : storybook (storybook.zip)',
        '2026-11-19T19:45:27.4769771Z ',
        '2026-11-19T19:45:28.4213155Z Associated artifact 1100 with build 42',
        '2026-11-19T19:45:28.4214465Z ##[section]Finishing: Publish Storybook',
        '',
      ].join('\r\n'),
    },
    marketplaceTask: MARKETPLACE_TASK,
    otherTasks: [DEV_TASK],
  };
}

test('a run is taken from the answers of the REST API', () => {
  const run = captureRun(answers());
  assert.deepEqual(run, {
    organization: 'Contoso',
    project: 'Web',
    pipeline: 'Design system',
    buildId: 42,
    buildNumber: '20261119.7',
    title: 'docs: show the Storybook tab in screenshots',
    result: 'succeeded',
    reason: 'Manually triggered',
    repository: 'web',
    branch: 'main',
    commit: '6bd524847e1c6d4a80f771ba72307aaba17d6346',
    started: '2026-11-19T19:45:05.6792087Z',
    durationMs: 36180,
    pipelineFile: 'samples/demo/azure-pipelines.yml',
    publishYaml: [
      '# Publishes the folder as a build artifact.',
      '- task: PublishStorybookDev@1',
      '  displayName: Publish Storybook',
      '  inputs:',
      '    storybookDir: storybook-static',
      '',
      '    title: Design system',
    ].join('\n'),
    marketplaceTask: 'PublishStorybook@1',
    issues: [{ type: 'warning', source: 'Build Storybook', message: 'The ubuntu-latest label will migrate.' }],
    jobs: [
      {
        name: 'Job',
        result: 'succeeded',
        durationMs: 20340,
        steps: [
          { name: 'Build Storybook', result: 'warning', durationMs: 3870 },
          {
            name: 'Publish Storybook',
            result: 'succeeded',
            durationMs: 1290,
            task: 'PublishStorybookDev@1',
            log: [
              '##[section]Starting: Publish Storybook',
              'Artifact         : storybook (storybook.zip)',
              '',
              'Associated artifact 1100 with build 42',
              '##[section]Finishing: Publish Storybook',
            ],
            artifact: 'storybook',
          },
        ],
      },
    ],
    artifacts: [
      {
        name: 'storybook',
        properties: {
          storybookpane: '1',
          storybooktitle: 'Design system',
          storybookarchive: 'storybook.zip',
          storybookstories: '15',
          artifactsize: '2304192',
        },
        file: 'storybook.zip',
      },
      { name: 'drop', properties: { artifactsize: '10' } },
    ],
    assets: 'runs/20261119.7/',
  } satisfies Run);
});

test('nothing about people, the agent or addresses in the organization is taken along', () => {
  const published = JSON.stringify(captureRun(answers()));
  for (const secret of ['Some One', 'someone@example.com', 'c0ffee00', 'Hosted Agent', 'dev.azure.com']) {
    assert.ok(!published.includes(secret), `the run must not contain "${secret}"`);
  }
});

test('a run with the task from the Marketplace names that task', () => {
  const run = captureRun(answers(MARKETPLACE_TASK));
  const step = run.jobs[0].steps.find((s) => s.task);
  assert.equal(step?.task, 'PublishStorybook@1');
  assert.equal(step?.task, run.marketplaceTask);
});

test('the steps of a task are cut out of a pipeline file as they are written', () => {
  const nested = [
    'jobs:',
    '  - job: build',
    '    steps:',
    '      - task: UseNode@1',
    '        inputs:',
    "          version: '22.x'",
    '      - task: PublishStorybook@1',
    '        inputs:',
    '          storybookDir: a/storybook-static',
    '      - task: "PublishStorybook@1"',
    '        displayName: Second',
    '      - script: echo done',
    '',
  ].join('\r\n');
  assert.equal(
    taskSteps(nested, ['PublishStorybook']),
    ['- task: PublishStorybook@1', '  inputs:', '    storybookDir: a/storybook-static', '', '- task: "PublishStorybook@1"', '  displayName: Second'].join('\n'),
  );
  assert.equal(taskSteps(nested, ['PublishStorybookDev']), '');
  // The last step of a file, without a line break at its end.
  assert.equal(taskSteps('steps:\n- task: PublishStorybook@1\n  inputs:\n    title: A', ['PublishStorybook']), '- task: PublishStorybook@1\n  inputs:\n    title: A');
});

test('the run of the demo comes with the Storybooks it lists', async () => {
  const root = process.cwd();
  const run = JSON.parse(fs.readFileSync(path.join(root, 'stories', 'demo', 'run.json'), 'utf8')) as Run;
  const storybooks = run.artifacts.filter((a) => a.file);
  assert.ok(storybooks.length > 0, 'the run has a Storybook');

  for (const artifact of storybooks) {
    const info = readStorybookInfo(artifact.name, artifact.properties);
    assert.ok(info, `${artifact.name} is tagged as a Storybook`);
    const bytes = fs.readFileSync(path.join(root, 'stories', 'assets', run.assets, artifact.file!));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    // As the tab opens it.
    const archive = await loadArchive(data, { entry: info.entry, archive: info.archive });
    assert.ok(archive.has(info.entry), `${artifact.file} has ${info.entry}`);
    if (info.fileCount !== undefined) assert.equal(archive.fileCount, info.fileCount);
  }

  // Every step that says it published an artifact points at one of the run.
  const names = new Set(run.artifacts.map((a) => a.name));
  for (const step of run.jobs.flatMap((j) => j.steps)) {
    if (step.artifact !== undefined) assert.ok(names.has(step.artifact), `${step.name} published ${step.artifact}`);
  }
});
