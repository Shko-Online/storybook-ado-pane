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

import * as SDK from 'azure-devops-extension-sdk';
import { getClient, type IHostNavigationService, type IProjectPageService } from 'azure-devops-extension-api';
import {
  BuildRestClient,
  BuildStatus,
  type Build,
  type IBuildPageDataService,
} from 'azure-devops-extension-api/Build';
import { showBanner } from '../shared/banner';
import { DEFAULT_ENTRY, readStorybookInfo } from '../shared/constants';
import { TAB_NAME } from '../shared/product';
import { formatPlace, parsePlace } from '../viewer/place';
import { luminance, setScheme } from '../viewer/theme';
import { readWithProgress, StorybookViewer, type StorybookRef, type StorybookSource } from '../viewer/ui';

// Service ids are const enums in the typings; spell them out so bundling stays simple.
const PROJECT_PAGE_SERVICE = 'ms.vss-tfs-web.tfs-page-data-service';
const BUILD_PAGE_DATA_SERVICE = 'ms.vss-build-web.build-page-data-service';
const HOST_NAVIGATION_SERVICE = 'ms.vss-features.host-navigation-service';

interface ArtifactRef extends StorybookRef {
  /** Artifact name, as in the run's list of artifacts. */
  name: string;
  /** Address of the artifact as a zip. */
  downloadUrl?: string;
  /** Timeline record of the job that published the artifact. */
  jobId?: string;
}

/** Storybooks published by the task, read from the build's artifacts. */
class BuildArtifactSource implements StorybookSource {
  private status: BuildStatus | undefined;
  private readonly client = getClient(BuildRestClient);

  constructor(
    private readonly project: string,
    private readonly buildId: number,
  ) {}

  mayPublishMore(): boolean {
    return this.status !== undefined && this.status !== BuildStatus.Completed;
  }

  async list(): Promise<ArtifactRef[]> {
    const [artifacts, build] = await Promise.all([
      this.client.getArtifacts(this.project, this.buildId),
      this.client.getBuild(this.project, this.buildId),
    ]);
    this.status = build.status;

    const refs: ArtifactRef[] = [];
    for (const artifact of artifacts) {
      // The task marks its artifacts with properties; every other artifact of the run is left alone.
      const info = readStorybookInfo(artifact.name, artifact.resource?.properties);
      if (!info) continue;
      refs.push({
        // The name is unique in a run, and it is what a link to a story carries.
        id: artifact.name,
        label: info.title,
        info,
        name: artifact.name,
        downloadUrl: artifact.resource?.downloadUrl,
        jobId: artifact.source,
      });
    }

    // The same title can come from several jobs (matrix, retries); tell them apart.
    const labels = refs.map((r) => r.label);
    if (new Set(labels).size !== labels.length) await this.addJobNames(refs);

    return refs.sort((a, b) => a.label.localeCompare(b.label));
  }

  async download(ref: StorybookRef, onProgress: (loaded: number, total?: number) => void): Promise<ArrayBuffer> {
    const r = ref as ArtifactRef;
    if (r.downloadUrl) {
      try {
        const token = await SDK.getAccessToken();
        const response = await fetch(r.downloadUrl, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/zip' },
        });
        if (!response.ok) throw new Error(`The server answered ${response.status} ${response.statusText}.`);
        // Azure DevOps packs the artifact into a zip as it sends it, and does not say how large
        // that will be. A Storybook published as one zip makes it about as large as that zip.
        const expected = r.info?.archive ? r.info.artifactBytes : undefined;
        return await readWithProgress(response, (loaded, total) => onProgress(loaded, total ?? expected));
      } catch (err) {
        // Fall back to the REST client (no progress) if a plain fetch is not possible here.
        try {
          return await this.client.getArtifactContentZip(this.project, this.buildId, r.name);
        } catch {
          throw err;
        }
      }
    }
    return this.client.getArtifactContentZip(this.project, this.buildId, r.name);
  }

  private async addJobNames(refs: ArtifactRef[]): Promise<void> {
    try {
      const timeline = await this.client.getBuildTimeline(this.project, this.buildId);
      const records = new Map(timeline.records.map((rec) => [rec.id, rec]));
      for (const ref of refs) {
        let rec = ref.jobId ? records.get(ref.jobId) : undefined;
        while (rec && rec.type !== 'Job' && rec.parentId) rec = records.get(rec.parentId);
        if (rec?.type === 'Job') {
          const attempt = rec.attempt > 1 ? ` (attempt ${rec.attempt})` : '';
          ref.label = `${ref.label} — ${rec.name}${attempt}`;
        }
      }
    } catch {
      // Labels stay ambiguous but usable.
    }
  }
}

/** The build-results-view contribution hands us the build either way, depending on the host. */
function currentBuild(): Promise<Pick<Build, 'id' | 'project'>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (build: any) => {
      if (settled || !build?.id) return;
      settled = true;
      resolve(build);
    };
    const config = SDK.getConfiguration();
    if (typeof config?.onBuildChanged === 'function') config.onBuildChanged(done);
    SDK.getService<IBuildPageDataService>(BUILD_PAGE_DATA_SERVICE)
      .then((svc) => done(svc.getBuildPageData()?.build))
      .catch(() => undefined);
    setTimeout(() => settled || reject(new Error('This page must be opened from a pipeline run.')), 15_000);
  });
}

async function main(): Promise<void> {
  showBanner(TAB_NAME);
  const root = document.getElementById('app')!;
  // The SDK applies the Azure DevOps theme as CSS variables, at start and whenever the user
  // switches theme. The Storybook follows it through the frame's color-scheme (see tab.css).
  window.addEventListener('themeApplied', followAzureDevOpsTheme);
  await SDK.init({ loaded: false, applyTheme: true });
  followAzureDevOpsTheme();

  try {
    const build = await currentBuild();
    const project =
      build.project?.id ??
      (await (await SDK.getService<IProjectPageService>(PROJECT_PAGE_SERVICE)).getProject())?.id;
    if (!project) throw new Error('Could not determine the current project.');

    // The fragment of the run page's address says which story is on screen (see place.ts), so
    // the address in the browser is a link to it. Without the service the tab works the same,
    // only without such links.
    const navigation = await SDK.getService<IHostNavigationService>(HOST_NAVIGATION_SERVICE).catch(() => undefined);
    const bare = (hash: string | undefined) => (hash ?? '').replace(/^#/, '');
    let fragment = bare(await Promise.resolve(navigation?.getHash()).catch(() => ''));

    const viewer = new StorybookViewer(root, new BuildArtifactSource(project, build.id), {
      start: parsePlace(fragment, DEFAULT_ENTRY),
      onNavigate: (place, entry, count) => {
        const next = formatPlace(place, entry, count > 1);
        if (next === fragment) return;
        fragment = next;
        // Replace, not set: the Storybook already adds its own steps to the browser's history.
        navigation?.replaceHash(next);
      },
    });
    // Someone edited the address, or followed a link to another story of this run.
    navigation?.onHashChanged((hash) => {
      const next = bare(hash);
      if (next === fragment) return;
      fragment = next;
      void viewer.goTo(parsePlace(next, DEFAULT_ENTRY));
    });
    await SDK.notifyLoadSucceeded();
    keepUsable();
    await viewer.refresh();
  } catch (err) {
    root.textContent = err instanceof Error ? err.message : String(err);
    await SDK.notifyLoadFailed(err instanceof Error ? err : String(err));
  }
}

/**
 * The run page gives the tab's frame the height that is left in the window, and keeps it that
 * way when the window changes, so the Storybook fills what there is without making the page
 * scroll. Asking the host for a size would pin the frame to it for good, so that is only done
 * when the window leaves too little to work in. The frame is still being laid out while the
 * tab starts, so look once things have settled.
 */
function keepUsable(): void {
  const MIN_HEIGHT = 360;
  window.setTimeout(() => {
    // Only the height: SDK.resize turns a missing width into the current body width, and the
    // host would pin the frame to it, so it stops following the window. NaN is sent as null,
    // the host writes "nullpx", the browser ignores that, and the width stays fluid.
    if (window.innerHeight < MIN_HEIGHT) SDK.resize(Number.NaN, 640);
  }, 3_000);
}

/** Light or dark Azure DevOps theme, from the theme's page background colour. */
function followAzureDevOpsTheme(): void {
  const background = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim();
  setScheme(background ? (luminance(background) < 0.5 ? 'dark' : 'light') : undefined);
}

void main();
