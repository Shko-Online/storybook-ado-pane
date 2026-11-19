# Storybook Viewer

Browse your [Storybook](https://storybook.js.org/) right inside Azure Pipelines. Publish the built Storybook from your pipeline, open the run, and select the **Storybook** tab. Reviewers see the components exactly as that run built them. There is nothing to deploy and nothing to download.

## What you get

- **A pipeline task** (`PublishStorybook@1`) that publishes the folder written by `storybook build` as a build artifact of the run, packed into one zip so that it is quick to publish and quick to open.
- **A "Storybook" tab** on the run page with the whole Storybook: the sidebar, stories, documentation pages, controls and the other addon panels. It fills the page and follows the size of the window.
- **Nothing to host.** The tab downloads the artifact, unpacks it in your browser's memory and shows it from there. You need no static site, storage account or preview environment.
- **A Storybook for every run.** Open the run of a pull request to review its components, or an older run to see how they looked then.
- **Several Storybooks in one run.** Publish one per package or app, and switch between them in the tab.

## Get started

1. Build your Storybook in the pipeline, as you do locally:

   ```yaml
   - script: npm ci
     displayName: Install dependencies

   - script: npx storybook build
     displayName: Build Storybook
   ```

2. Add the task after it:

   ```yaml
   - task: PublishStorybook@1
     inputs:
       storybookDir: storybook-static
   ```

3. Run the pipeline, open the run, and select the **Storybook** tab.

When a run publishes more than one Storybook, give each its own artifact name, and a title to tell them apart in the tab:

```yaml
- task: PublishStorybook@1
  inputs:
    storybookDir: packages/design-system/storybook-static
    artifactName: storybook-design-system
    title: Design system

- task: PublishStorybook@1
  inputs:
    storybookDir: apps/admin/storybook-static
    artifactName: storybook-admin
    title: Admin app
```

## Task inputs

| Input | Default | Description |
| --- | --- | --- |
| `storybookDir` | `storybook-static` | Folder that contains the built Storybook. Relative to `$(System.DefaultWorkingDirectory)`. |
| `artifactName` | `storybook` | Name of the build artifact. Use a name of its own for each Storybook of a run, different from the other artifacts the run publishes. |
| `title` | the artifact name | Name shown in the tab. |
| `ifMissing` | `warn` | `warn`, `error` or `ignore` when the folder or its `index.html` is missing. |

## Notes

- **A regular build artifact.** The Storybook is listed with the other artifacts of the run, as one file: `storybook.zip`. You can download it there, and later stages can use it, for example to unzip and deploy it. It is kept as long as the artifacts of the run are, which the retention settings of your project decide.
- **Links to a story.** The address of the run page follows the story you open. Copy it from the browser to bring a colleague to the same story of the same run.
- **Open in new tab** gives the Storybook a browser tab of its own, on the story you were looking at.
- **Runs in progress.** The tab checks for new Storybooks every few seconds until the run completes.
- **Light and dark.** Storybook's interface follows the theme of Azure DevOps, unless your Storybook sets a theme of its own.
- **Absolute paths work.** A Storybook that refers to its files from the root of a site (`/logo.png`) finds them, although it is not at the root of one here.
- **Permissions.** The extension only asks for *Build (read)*, to read the artifacts of a run.

## Limitations

- **Browsers that block storage for embedded pages.** The tab shows the Storybook with a service worker. A browser that blocks third-party cookies and storage, and private windows of some browsers, do not allow one in a page embedded in Azure DevOps. The tab then offers **Open in new tab**, where the Storybook works.
- **Mock Service Worker.** For the same reason a Storybook cannot start a service worker of its own in the tab, so stories that mock requests with [Mock Service Worker](https://mswjs.io/) do not get their mocks. The tab tells you when a Storybook tries.
- **Size.** The whole Storybook is downloaded before it opens. A very large one (hundreds of megabytes of static files) takes a while and needs that much memory.

## Trust

A Storybook is a web application, and the tab runs it in your browser. Its code gets the access the tab has: it can read the builds of your organization as you. The HTML reports that other pipeline extensions show work the same way. Open the Storybooks of runs you trust, and treat a Storybook built from an untrusted pull request as you would treat running that code.

## Privacy

The extension has no telemetry. The Storybook is downloaded from your Azure DevOps organization and unpacked in your browser. It is not sent anywhere, and nothing is saved to disk. What a story loads from other sites (fonts, images, APIs) is up to the story.

## Built for free by Shko Online

Storybook Viewer is built and maintained for free by [Shko Online](https://shko.online/?utm_source=azure-devops&utm_medium=marketplace&utm_campaign=storybook-ado-pane), a Microsoft Business Applications consultancy in Tirana, Albania. We build Azure DevOps extensions, pipelines and test automation, and deliver Dynamics 365, Power Platform and Azure projects.

Need a feature, or help with your next project? [Book a consultation](https://shko.online/contact-us?utm_source=azure-devops&utm_medium=marketplace&utm_campaign=storybook-ado-pane) or write to sales@shko.online.

Storybook Viewer is open source under the [Apache License 2.0](https://github.com/Shko-Online/storybook-ado-pane/blob/main/LICENSE). Storybook is a trademark of its respective owners; this extension is an independent project and is not affiliated with or endorsed by the Storybook project.
