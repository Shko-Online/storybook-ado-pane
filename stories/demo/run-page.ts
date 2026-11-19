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
 * A stand-in for the Azure DevOps page of a pipeline run (run-data.ts). Only the "Storybook"
 * tab is real: it is the extension's StorybookViewer, showing the Storybooks that run
 * published. The rest is a lightweight recreation, so the tab can be tried without
 * installing the extension in an organization.
 */
import { DEFAULT_ENTRY } from '../../src/shared/constants';
import { TAB_NAME } from '../../src/shared/product';
import { formatPlace, parsePlace, type Place } from '../../src/viewer/place';
import { formatBytes, type StorybookViewer } from '../../src/viewer/ui';
import { icons } from './icons';
import { run, type Artifact, type Issue, type Job, type Result, type Step } from './run-data';
import { DemoRunSource, mountViewer, storybookOf } from './sources';

export type RunTab = 'summary' | 'storybook';

export interface RunPageOptions {
  tab: RunTab;
  /** Show the strip that explains this is a demo. */
  demoBanner: boolean;
  /** Called by the theme button in the top bar; the button is hidden without it. */
  onToggleTheme?: () => void;
}

const GITHUB = 'https://github.com/Shko-Online/storybook-ado-pane';
const MARKETPLACE = 'https://marketplace.visualstudio.com/items?itemName=shko-online.storybook-ado-pane';

const RESULT: Record<Result, string> = {
  succeeded: 'Succeeded',
  warning: 'Succeeded with issues',
  failed: 'Failed',
  canceled: 'Canceled',
  skipped: 'Skipped',
};

const storybooks = run.artifacts.filter((a) => storybookOf(a));
const storybookWord = storybooks.length === 1 ? 'Storybook' : 'Storybooks';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function duration(ms: number): string {
  if (ms < 1000) return `<1s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function statusIcon(result: Result, size = 16): string {
  if (result === 'succeeded') return icons.succeeded(size);
  if (result === 'failed') return icons.failed(size);
  return result === 'warning' ? icons.warning(size) : icons.skipped(size);
}

/** Two letters for the project's picture, as Azure DevOps makes them: "Shko.Online" → "SO". */
function initials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

export function createRunPage(options: RunPageOptions): HTMLElement {
  const page = document.createElement('div');
  page.className = 'ado';

  page.innerHTML = `
    ${options.demoBanner ? demoBanner() : ''}
    <header class="ado-topbar">
      <span class="ado-logo">${icons.logo()}</span>
      <nav class="ado-breadcrumb" aria-label="Breadcrumb">
        <span>${esc(run.organization)}</span><span class="ado-sep">/</span>
        <span>${esc(run.project)}</span><span class="ado-sep">/</span>
        <span>Pipelines</span><span class="ado-sep">/</span>
        <span>${esc(run.pipeline)}</span><span class="ado-sep">/</span>
        <span aria-current="page">${esc(run.buildNumber)}</span>
      </nav>
      <span class="ado-search">${icons.search()}<span>Search</span></span>
      <button type="button" class="ado-topbar-icon ado-theme-toggle" data-theme-toggle aria-pressed="false"
        aria-label="Dark theme" title="Switch between the light and dark theme"${options.onToggleTheme ? '' : ' hidden'}>
        <span class="ado-when-light">${icons.moon()}</span><span class="ado-when-dark">${icons.sun()}</span>
      </button>
    </header>
    <div class="ado-body">
      <nav class="ado-rail" aria-label="Project navigation">
        <span class="ado-project-avatar" title="${esc(run.project)}">${esc(initials(run.project))}</span>
        <span class="ado-rail-item" title="Overview">${icons.overview()}</span>
        <span class="ado-rail-item" title="Boards">${icons.boards()}</span>
        <span class="ado-rail-item" title="Repos">${icons.repos()}</span>
        <span class="ado-rail-item is-active" title="Pipelines">${icons.pipelines()}</span>
        <span class="ado-rail-item" title="Test Plans">${icons.testPlans()}</span>
        <span class="ado-rail-item" title="Artifacts">${icons.artifacts()}</span>
      </nav>
      <main class="ado-page">
        <div class="ado-run-header">
          <span class="ado-run-status">${statusIcon(run.result, 28)}</span>
          <div class="ado-run-title">
            <h1>#${esc(run.buildNumber)} • ${esc(run.title)}</h1>
            <div class="ado-muted">${icons.pipelines()} ${esc(run.pipeline)}</div>
          </div>
          <div class="ado-run-actions">
            ${run.result === 'failed' ? '<button type="button" class="ado-button" disabled title="Not available in this demo">Rerun failed jobs</button>' : ''}
            <button type="button" class="ado-button ado-button-primary" disabled title="Not available in this demo">Run new</button>
          </div>
        </div>
        <div class="ado-tabs" role="tablist">
          ${tabButton('summary', 'Summary')}
          ${tabButton('storybook', TAB_NAME)}
        </div>
        <section class="ado-panel ado-scroll" data-panel="summary" role="tabpanel" aria-label="Summary">
          ${summary()}
        </section>
        <section class="ado-panel ado-extension" data-panel="storybook" role="tabpanel" aria-label="${TAB_NAME}">
          <div class="ado-extension-root"></div>
        </section>
      </main>
    </div>`;

  const viewerRoot = page.querySelector<HTMLElement>('.ado-extension-root')!;
  let viewer: StorybookViewer | undefined;
  /** The Storybook on screen in the tab. */
  let shown: string | undefined;

  // The tab keeps the story on screen in the fragment of the run page's address, which makes
  // that address a link to the story. This page's own address stands in for it.
  let fragment = location.hash.slice(1);
  const mount = (start: Place) => {
    viewer = mountViewer(viewerRoot, new DemoRunSource(), {
      start,
      onNavigate: (place, entry, count) => {
        shown = place.id;
        const next = formatPlace(place, entry, count > 1);
        if (next === fragment || !page.isConnected) return;
        fragment = next;
        history.replaceState(history.state, '', next ? `#${next}` : location.pathname + location.search);
      },
    });
  };

  const show = (tab: RunTab, place?: Place) => {
    page.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
    page.querySelectorAll<HTMLElement>('[role="tab"]').forEach((t) => {
      const active = t.dataset.tab === tab;
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
    });
    if (tab !== 'storybook') return;
    // Like Azure DevOps, the extension's frame only loads when its tab is first opened.
    if (!viewer) mount(place ?? parsePlace(fragment, DEFAULT_ENTRY));
    else if (place) void viewer.goTo(place);
  };

  page.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>(
      '[data-tab], [data-open-storybook], [data-toggle], [data-scroll], [data-theme-toggle]',
    );
    if (!el) return;
    if (el.hasAttribute('data-theme-toggle')) options.onToggleTheme?.();
    else if (el.dataset.tab) show(el.dataset.tab as RunTab);
    else if (el.dataset.openStorybook) {
      // The one on screen stays on its story; another one starts from its first page.
      const name = el.dataset.openStorybook;
      show('storybook', viewer && shown === name ? undefined : { id: name });
    } else if (el.dataset.scroll) {
      page.querySelector(`#${el.dataset.scroll}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (el.dataset.toggle) {
      const target = page.querySelector<HTMLElement>(`#${el.dataset.toggle}`)!;
      target.hidden = !target.hidden;
      el.setAttribute('aria-expanded', String(!target.hidden));
    }
  });
  page.querySelector('.ado-tabs')!.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft') return;
    const tabs = [...page.querySelectorAll<HTMLElement>('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    const next = tabs[(i + (key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    show(next.dataset.tab as RunTab);
  });

  // Someone edited the address, or followed a link to another story of this run.
  const onHashChange = () => {
    if (!page.isConnected) {
      window.removeEventListener('hashchange', onHashChange);
      return;
    }
    const next = location.hash.slice(1);
    if (next === fragment) return;
    fragment = next;
    show('storybook', parsePlace(next, DEFAULT_ENTRY));
  };
  window.addEventListener('hashchange', onHashChange);

  // The theme lives on <html> (set by .storybook/preview.ts); mirror it on the toggle.
  const themeButton = page.querySelector<HTMLElement>('[data-theme-toggle]')!;
  const syncThemeButton = () =>
    themeButton.setAttribute('aria-pressed', String(document.documentElement.dataset.adoTheme === 'dark'));
  const themeWatch = new MutationObserver(() => (page.isConnected ? syncThemeButton() : themeWatch.disconnect()));
  themeWatch.observe(document.documentElement, { attributeFilter: ['data-ado-theme'] });
  syncThemeButton();

  show(options.tab);
  return page;
}

function demoBanner(): string {
  return `<div class="ado-demo-banner">
    <strong>Interactive demo</strong>
    <span>A recreation of pipeline run #${esc(run.buildNumber)} of the
      <a href="${GITHUB}/tree/main/samples/demo" target="_blank" rel="noopener">sample project</a>.
      The <b>${TAB_NAME}</b> tab is the real extension, showing the ${storybookWord} that run published.</span>
    <span class="ado-demo-links">
      <a href="${MARKETPLACE}" target="_blank" rel="noopener">Get the extension ${icons.external()}</a>
      <a href="${GITHUB}" target="_blank" rel="noopener">Source on GitHub ${icons.external()}</a>
    </span>
  </div>`;
}

function tabButton(tab: RunTab, label: string): string {
  return `<button type="button" role="tab" class="ado-tab" data-tab="${tab}">${label}</button>`;
}

function summary(): string {
  const started = new Date(run.started).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const errors = run.issues.filter((i) => i.type === 'error').length;
  const warnings = run.issues.length - errors;
  return `
    <div class="ado-card ado-facts">
      <div class="ado-fact">
        <div class="ado-fact-label">${icons.person()} ${esc(run.reason)}</div>
        <div class="ado-fact-value">${statusIcon(run.result)} ${RESULT[run.result]}</div>
      </div>
      <div class="ado-fact">
        <div class="ado-fact-label">${icons.repo()} Repository and version</div>
        <div class="ado-fact-value">${esc(run.repository)}</div>
        <div class="ado-fact-sub">${icons.branch()} ${esc(run.branch)} &nbsp; ${icons.commit()} ${esc(run.commit.slice(0, 7))}</div>
      </div>
      <div class="ado-fact">
        <div class="ado-fact-label">${icons.clock()} Time started and elapsed</div>
        <div class="ado-fact-value">${esc(started)}</div>
        <div class="ado-fact-sub">${duration(run.durationMs)}</div>
      </div>
      <div class="ado-fact">
        <div class="ado-fact-label">${icons.artifacts()} Related</div>
        <div class="ado-fact-value"><button type="button" class="ado-link" data-scroll="ado-artifacts">${run.artifacts.length} published</button></div>
      </div>
      <div class="ado-fact">
        <div class="ado-fact-label">${icons.book()} ${TAB_NAME}</div>
        <div class="ado-fact-value"><button type="button" class="ado-link" data-tab="storybook">${storybooks.length} ${storybookWord}</button></div>
      </div>
    </div>

    ${
      run.issues.length > 0
        ? `<div class="ado-card">
      <h2>Errors <span class="ado-count">${errors}</span> Warnings <span class="ado-count">${warnings}</span></h2>
      <ul class="ado-issues">${run.issues.map(issue).join('')}</ul>
    </div>`
        : ''
    }

    <div class="ado-card">
      <h2>Jobs</h2>
      ${run.jobs.map(job).join('')}
    </div>

    <div class="ado-card" id="ado-artifacts">
      <h2>Artifacts <span class="ado-count">${run.artifacts.length}</span></h2>
      <p class="ado-muted">A Storybook is a regular build artifact of the run: one zip. The ${TAB_NAME} tab downloads it and unpacks it in the browser.</p>
      <ul class="ado-artifacts">${run.artifacts.map(artifact).join('')}</ul>
    </div>

    <div class="ado-card">
      <h2>How this run published its ${storybookWord}</h2>
      <p class="ado-muted">From <a href="${GITHUB}/blob/main/${esc(run.pipelineFile)}" target="_blank" rel="noopener">${esc(run.pipelineFile)}</a>, after the step that builds the Storybook:</p>
      <pre class="ado-code">${esc(run.publishYaml)}</pre>
      ${devBuildNote()}
    </div>`;
}

/** The run of the demo may be one that tried the private dev build, whose task has another name. */
function devBuildNote(): string {
  const used = run.jobs.flatMap((j) => j.steps).find((s) => s.task && s.task !== run.marketplaceTask)?.task;
  if (!used) return '';
  return `<p class="ado-muted">This run tried the dev build of the extension, which has a task of its own, <code>${esc(used)}</code>.
    With the extension from the Marketplace the task is <code>${esc(run.marketplaceTask)}</code>.</p>`;
}

function issue(i: Issue): string {
  return `<li class="ado-issue">${i.type === 'error' ? icons.failed() : icons.warning()}
    <div><div>${esc(i.message)}</div><div class="ado-muted">${esc(i.source)}</div></div></li>`;
}

function job(j: Job, index: number): string {
  const id = `ado-steps-${index}`;
  return `
    <button type="button" class="ado-job" data-toggle="${id}" aria-expanded="true" aria-controls="${id}">
      <span class="ado-chevron">${icons.chevron()}</span>
      ${statusIcon(j.result)}
      <span class="ado-job-name">${esc(j.name)}</span>
      <span class="ado-muted">${duration(j.durationMs)}</span>
    </button>
    <ol class="ado-steps" id="${id}">${j.steps.map((s, i) => step(s, `${id}-log-${i}`)).join('')}</ol>`;
}

function step(s: Step, logId: string): string {
  const published = storybooks.find((a) => a.name === s.artifact);
  return `<li class="ado-step${s.task ? ' is-highlighted' : ''}">
    <div class="ado-step-row">
      ${statusIcon(s.result)}
      <span class="ado-step-name">${esc(s.name)}${s.task ? `<span class="ado-task-ref">${esc(s.task)}</span>` : ''}</span>
      ${
        s.log
          ? `<button type="button" class="ado-link ado-log-toggle" data-toggle="${logId}" aria-expanded="false" aria-controls="${logId}">
        <span class="ado-chevron">${icons.chevron()}</span>Log</button>`
          : ''
      }
      ${published ? `<button type="button" class="ado-link" data-open-storybook="${esc(published.name)}">View Storybook</button>` : ''}
      <span class="ado-muted ado-step-duration">${duration(s.durationMs)}</span>
    </div>
    ${s.log ? `<pre class="ado-code ado-log" id="${logId}" hidden>${s.log.map(logLine).join('\n')}</pre>` : ''}
  </li>`;
}

/** A line of a step's log; the agent's own "##[section]" lines stand out, as on the run page. */
function logLine(line: string): string {
  const section = /^##\[section\](.*)$/.exec(line);
  return section ? `<span class="ado-log-section">${esc(section[1])}</span>` : esc(line);
}

function artifact(a: Artifact): string {
  const info = storybookOf(a);
  const size = Number(a.properties.artifactsize);
  const holds = [info?.archive, Number.isFinite(size) && size > 0 ? formatBytes(size) : ''].filter(Boolean).join(' · ');
  const about = info
    ? [
        info.storyCount !== undefined ? `${info.storyCount} ${info.storyCount === 1 ? 'story' : 'stories'}` : '',
        info.storybookVersion ? `Storybook ${info.storybookVersion}` : '',
        info.fileCount !== undefined ? `${info.fileCount} ${info.fileCount === 1 ? 'file' : 'files'}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  return `<li class="ado-artifact">
    ${icons.artifacts()}
    <div class="ado-artifact-name"><b>${esc(a.name)}</b>${holds ? `<div class="ado-muted">${esc(holds)}</div>` : ''}</div>
    ${
      info
        ? `<div class="ado-artifact-what">${esc(info.title)}${about ? `<div class="ado-muted">${esc(about)}</div>` : ''}</div>
    <button type="button" class="ado-link" data-open-storybook="${esc(a.name)}">View Storybook</button>`
        : ''
    }
  </li>`;
}
