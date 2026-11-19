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
 * Turns what the Azure DevOps REST API says about a pipeline run into the run of the demo
 * (run-data.ts). scripts/capture-run.mjs does the calling and hands the answers to
 * {@link captureRun}.
 *
 * The demo is public, and the API says more than the page shows: who queued the run, who
 * changed it last, ids and addresses inside the organization. So nothing is copied as a
 * whole. Every field of the result is taken by name, and people are not among them.
 */
import { PROPERTY, readStorybookInfo } from '../../src/shared/constants';
import type { Artifact, Issue, Job, Result, Run, Step } from './run-data';

/** The parts of the API's answers that are used. */
export interface ApiBuild {
  id: number;
  buildNumber: string;
  result?: string;
  reason?: string;
  sourceBranch?: string;
  sourceVersion?: string;
  startTime?: string;
  finishTime?: string;
  definition?: { name?: string };
  repository?: { name?: string };
}

export interface ApiTimelineRecord {
  id: string;
  parentId?: string | null;
  /** `Stage`, `Phase`, `Job`, `Task`, `Checkpoint`… */
  type: string;
  name: string;
  order?: number | null;
  result?: string | null;
  startTime?: string | null;
  finishTime?: string | null;
  task?: { id?: string; name?: string; version?: string } | null;
  issues?: { type?: string; message?: string }[] | null;
}

export interface ApiArtifact {
  id: number;
  name: string;
  resource?: { properties?: Record<string, string> };
}

/** A pipeline task of this extension (task.json, task.dev.json). */
export interface ExtensionTask {
  id: string;
  name: string;
}

export interface CaptureInput {
  organization: string;
  project: string;
  build: ApiBuild;
  records: ApiTimelineRecord[];
  artifacts: ApiArtifact[];
  /** Message of the commit the run built. */
  commitMessage: string;
  /** Path of the pipeline's YAML file in the repository, and its text at that commit. */
  pipelineFile: string;
  pipelineYaml: string;
  /** Logs by timeline record id, for the steps that ran a task of this extension. */
  logs: Record<string, string>;
  /** The extension's task as the Marketplace has it, and the other identities it is built with. */
  marketplaceTask: ExtensionTask;
  otherTasks: ExtensionTask[];
}

/** Why a run started, in the words of the run page. */
const REASONS: Record<string, string> = {
  manual: 'Manually triggered',
  individualCI: 'Individual CI',
  batchedCI: 'Batched CI',
  schedule: 'Scheduled',
  pullRequest: 'Pull request',
  buildCompletion: 'Triggered by a pipeline',
  resourceTrigger: 'Triggered by a resource',
};

export function captureRun(input: CaptureInput): Run {
  const { build, records } = input;
  const tasks = [input.marketplaceTask, ...input.otherTasks];
  const isOurs = (record: ApiTimelineRecord) =>
    tasks.some((t) => t.id.toLowerCase() === record.task?.id?.toLowerCase());
  const artifactNames = new Map(input.artifacts.map((a) => [a.id, a.name]));

  const jobs: Job[] = records
    .filter((r) => r.type === 'Job')
    .sort(byStart)
    .map((job) => ({
      name: job.name,
      result: result(job.result),
      durationMs: duration(job.startTime, job.finishTime),
      steps: records
        .filter((r) => r.type === 'Task' && r.parentId === job.id)
        .sort(byOrder)
        .map((record): Step => {
          const step: Step = {
            name: record.name,
            result: result(record.result),
            durationMs: duration(record.startTime, record.finishTime),
          };
          if (isOurs(record)) {
            step.task = taskReference(record.task?.name, record.task?.version);
            const log = input.logs[record.id];
            if (log !== undefined) {
              step.log = logLines(log);
              step.artifact = publishedArtifact(step.log, artifactNames);
            }
          }
          return step;
        }),
    }));

  const issues: Issue[] = [];
  for (const record of [...records].sort(byStart)) {
    for (const issue of record.issues ?? []) {
      if (!issue.message) continue;
      issues.push({ type: issue.type === 'error' ? 'error' : 'warning', source: record.name, message: issue.message });
    }
  }

  // The major version of the task is the one the run used: a pipeline names it (`@1`).
  const major = records.find((r) => r.type === 'Task' && isOurs(r))?.task?.version;

  return {
    organization: input.organization,
    project: input.project,
    pipeline: build.definition?.name ?? '',
    buildId: build.id,
    buildNumber: build.buildNumber,
    title: input.commitMessage.split('\n')[0].trim(),
    result: result(build.result),
    reason: REASONS[build.reason ?? ''] ?? build.reason ?? '',
    repository: build.repository?.name ?? '',
    branch: (build.sourceBranch ?? '').replace(/^refs\/heads\//, ''),
    commit: build.sourceVersion ?? '',
    started: build.startTime ?? '',
    durationMs: duration(build.startTime, build.finishTime),
    pipelineFile: input.pipelineFile.replace(/^\/+/, ''),
    publishYaml: taskSteps(
      input.pipelineYaml,
      tasks.map((t) => t.name),
    ),
    marketplaceTask: taskReference(input.marketplaceTask.name, major),
    issues,
    jobs,
    artifacts: input.artifacts.map((artifact): Artifact => {
      const properties = shownProperties(artifact.resource?.properties);
      const captured: Artifact = { name: artifact.name, properties };
      if (readStorybookInfo(artifact.name, properties)) captured.file = `${artifact.name}.zip`;
      return captured;
    }),
    assets: `runs/${build.buildNumber}/`,
  };
}

/**
 * The steps of a pipeline file that use one of `tasks`, as they are written there: each
 * `- task: <name>@<n>` with the lines that belong to it and the comment lines right above it.
 */
export function taskSteps(yaml: string, tasks: string[]): string {
  const lines = yaml.replace(/\r\n?/g, '\n').split('\n');
  const steps: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = /^(\s*)-\s+task:\s*['"]?([^@\s'"]+)@/.exec(lines[i]);
    if (!start || !tasks.includes(start[2])) continue;
    const indent = start[1].length;

    let first = i;
    while (first > 0 && lines[first - 1].startsWith(`${start[1]}#`)) first--;
    let last = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (lines[j].length - lines[j].trimStart().length <= indent) break;
      last = j;
    }
    steps.push(
      lines
        .slice(first, last + 1)
        .map((line) => line.slice(indent).trimEnd())
        .join('\n'),
    );
    i = last;
  }
  return steps.join('\n\n');
}

/** `PublishStorybook@1` from a task's name and the version a run used (`1.0.3`). */
function taskReference(name: string | undefined, version: string | undefined): string {
  const major = /^\d+/.exec(version ?? '')?.[0];
  return major ? `${name}@${major}` : String(name);
}

/** A log as the run page shows it: without the time in front of each line. */
function logLines(log: string): string[] {
  const lines = log
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** The artifact a step published: the agent says so in the log ("Associated artifact 12 with build 34"). */
function publishedArtifact(log: string[], names: Map<number, string>): string | undefined {
  for (const line of log) {
    const id = /Associated artifact (\d+) with build/.exec(line)?.[1];
    if (id !== undefined && names.has(Number(id))) return names.get(Number(id));
  }
  return undefined;
}

/** The properties of an artifact that the tab reads, and none of the others. */
function shownProperties(properties: Record<string, string> | undefined): Record<string, string> {
  const shown: Record<string, string> = {};
  const ours = new Set<string>(Object.values(PROPERTY));
  for (const [key, value] of Object.entries(properties ?? {})) {
    const name = key.toLowerCase();
    if (ours.has(name) || name === 'artifactsize') shown[name] = String(value);
  }
  return shown;
}

function result(value: string | null | undefined): Result {
  switch (value) {
    case 'succeeded':
      return 'succeeded';
    case 'succeededWithIssues':
    case 'partiallySucceeded':
      return 'warning';
    case 'canceled':
    case 'abandoned':
      return 'canceled';
    case 'skipped':
      return 'skipped';
    default:
      return 'failed';
  }
}

function duration(start: string | null | undefined, finish: string | null | undefined): number {
  const ms = Date.parse(finish ?? '') - Date.parse(start ?? '');
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
}

function byOrder(a: ApiTimelineRecord, b: ApiTimelineRecord): number {
  return (a.order ?? 0) - (b.order ?? 0);
}

function byStart(a: ApiTimelineRecord, b: ApiTimelineRecord): number {
  return (Date.parse(a.startTime ?? '') || 0) - (Date.parse(b.startTime ?? '') || 0) || byOrder(a, b);
}
