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

// Publishes the dev build: the private "-dev" variant of the extension, for internal use.
//
//   node scripts/release/dev.mjs --org <organization> [--install] [--version 1.2.3] [--dry-run]
//
// It packages the dev variant (scripts/package.mjs --dev), uploads it to the Marketplace as a
// private extension, and shares it with one Azure DevOps organization. Nobody else can see or
// install it. `--install` also installs it in that organization the first time; after that
// the organization picks up every new version by itself.
//
// Authentication is your own Azure CLI login (`az login`): you must be a member of the
// Marketplace publisher, and an administrator of the organization for `--install`. Production
// releases do not go through here: they are made by semantic-release in GitHub Actions.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const MARKETPLACE = 'https://marketplace.visualstudio.com';
/** Application id of Azure DevOps, which the Marketplace belongs to. */
const AZURE_DEVOPS_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const org = option('--org') ?? process.env.AZURE_DEVOPS_ORG;
const install = args.includes('--install');
const dryRun = args.includes('--dry-run');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vss-extension.json'), 'utf8'));
const devManifest = JSON.parse(fs.readFileSync(path.join(root, 'vss-extension.dev.json'), 'utf8'));
const publisher = manifest.publisher;
const extension = devManifest.id;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Version of a dev build: the major and minor of the latest release, and a patch that only
 * grows (two digits of the year, day of the year, hour and minute, in UTC). The Marketplace
 * wants every upload to be newer than the last, and agents cache tasks by version.
 */
function devVersion() {
  let [major, minor] = [1, 0];
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = /^v(\d+)\.(\d+)\.\d+$/.exec(tag);
    if (m) [major, minor] = [Number(m[1]), Number(m[2])];
  } catch {
    // no release yet
  }
  const now = new Date();
  const dayOfYear = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86_400_000);
  const pad = (n, width) => String(n).padStart(width, '0');
  const patch = `${now.getUTCFullYear() % 100}${pad(dayOfYear, 3)}${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}`;
  return `${major}.${minor}.${Number(patch)}`;
}

function accessToken() {
  try {
    const token = execFileSync(
      'az',
      ['account', 'get-access-token', '--resource', AZURE_DEVOPS_RESOURCE, '--query', 'accessToken', '-o', 'tsv'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (!token) throw new Error('empty token');
    return token;
  } catch (err) {
    throw new Error(`Could not get an access token from the Azure CLI. Run \`az login\` first. (${String(err.message).split('\n')[0]})`);
  }
}

async function call(token, method, url, { body, type, accept = 'application/json;api-version=7.1-preview.2' } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      ...(type ? { 'Content-Type': type } : {}),
      ...(body === undefined && method !== 'GET' ? { 'Content-Length': '0' } : {}),
    },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // not JSON (a sign-in page, an HTML error)
  }
  return { status: res.status, ok: res.ok, json, text };
}

const explain = (r) => r.json?.message ?? r.text.trim().slice(0, 300);

/** The Marketplace lists flags as text: "validated, public". */
const hasFlag = (flags, flag) =>
  String(flags ?? '')
    .toLowerCase()
    .split(/[,\s]+/)
    .includes(flag);

async function main() {
  if (!org) throw new Error('Which organization? Pass --org <organization> (or set AZURE_DEVOPS_ORG).');
  if (manifest.id === extension) throw new Error('vss-extension.dev.json must give the dev build an id of its own.');

  const version = option('--version') ?? devVersion();
  console.log(`Dev build ${publisher}.${extension} ${version}`);
  execFileSync(process.execPath, ['scripts/package.mjs', '--dev', '--version', version], { cwd: root, stdio: 'inherit' });
  const vsix = path.join(root, 'out', `${publisher}.${extension}-${version}.vsix`);
  if (!fs.existsSync(vsix)) throw new Error(`Package not found: ${vsix}`);

  // Never let this command publish something everybody can see.
  const packaged = await JSZip.loadAsync(fs.readFileSync(vsix));
  const vsixManifest = await packaged.file('extension.vsixmanifest').async('string');
  if (!vsixManifest.includes(`Id="${extension}"`)) throw new Error(`The package is not ${extension}.`);
  if (/<GalleryFlags>[^<]*\bPublic\b/i.test(vsixManifest)) {
    throw new Error('The package is marked public. The dev build must stay private (vss-extension.dev.json "public": false).');
  }

  if (dryRun) {
    console.log(`Dry run: ${path.relative(root, vsix)} is ready; nothing was uploaded.`);
    return;
  }

  const token = accessToken();
  const api = `${MARKETPLACE}/_apis/gallery`;
  const bytes = fs.readFileSync(vsix);

  const existing = await call(token, 'GET', `${api}/publishers/${publisher}/extensions/${extension}`);
  if (existing.status !== 200 && existing.status !== 404) {
    throw new Error(`Could not look up the extension (${existing.status}): ${explain(existing)}`);
  }
  if (existing.status === 200 && hasFlag(existing.json?.flags, 'public')) {
    throw new Error(`${publisher}.${extension} is public on the Marketplace. Refusing to update it from a dev build.`);
  }
  const upload =
    existing.status === 200
      ? await call(token, 'PUT', `${api}/publishers/${publisher}/extensions/${extension}`, { body: bytes, type: 'application/octet-stream' })
      : await call(token, 'POST', `${api}/extensions`, { body: bytes, type: 'application/octet-stream' });
  if (!upload.ok) throw new Error(`The Marketplace did not accept the package (${upload.status}): ${explain(upload)}`);
  console.log(`${existing.status === 200 ? 'Updated' : 'Created'} the private extension ${publisher}.${extension}.`);

  const share = await call(token, 'POST', `${api}/publisher/${publisher}/extension/${extension}/accountsbyname/${encodeURIComponent(org)}`, {
    accept: 'application/json;api-version=7.1-preview.1',
  });
  if (!share.ok) throw new Error(`Could not share the extension with ${org} (${share.status}): ${explain(share)}`);
  console.log(`Shared with the organization ${org}.`);

  // The Marketplace checks every upload before it hands it out; that takes a minute or two.
  process.stdout.write('Waiting for the Marketplace to validate the package');
  let validated = false;
  for (let i = 0; i < 60 && !validated; i++) {
    await sleep(10_000);
    process.stdout.write('.');
    const state = await call(token, 'GET', `${api}/publishers/${publisher}/extensions/${extension}?flags=1`);
    const latest = state.json?.versions?.find((v) => v.version === version);
    validated = hasFlag(latest?.flags, 'validated');
    if (latest?.validationResultMessage && !validated && /fail|error/i.test(latest.validationResultMessage)) {
      throw new Error(`\nThe Marketplace rejected the package: ${latest.validationResultMessage}`);
    }
  }
  console.log(validated ? ' done.' : ' still running; the organization will get the version once it is validated.');

  const installed = `https://extmgmt.dev.azure.com/${encodeURIComponent(org)}/_apis/extensionmanagement/installedextensionsbyname/${publisher}/${extension}?api-version=7.1-preview.1`;
  let current = await call(token, 'GET', installed);
  if (current.status === 404 || current.json?.typeKey === 'InstalledExtensionNotFoundException') {
    if (!install) {
      console.log(`It is not installed in ${org} yet. Run again with --install, or install it from`);
      console.log(`  ${MARKETPLACE}/items?itemName=${publisher}.${extension}`);
      return;
    }
    current = await call(token, 'POST', installed);
    if (!current.ok) throw new Error(`Could not install the extension in ${org} (${current.status}): ${explain(current)}`);
    console.log(`Installed in ${org}.`);
  }
  for (let i = 0; i < 30 && current.json?.version !== version; i++) {
    await sleep(10_000);
    current = await call(token, 'GET', installed);
  }
  console.log(
    current.json?.version === version
      ? `${org} now runs ${publisher}.${extension} ${version}. Its task is ${devTaskName()}@${version.split('.')[0]}.`
      : `${org} still runs ${current.json?.version ?? 'an older version'}; it updates by itself within a few minutes.`,
  );
}

function devTaskName() {
  return JSON.parse(fs.readFileSync(path.join(root, 'tasks/PublishStorybook/task.dev.json'), 'utf8')).name;
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
