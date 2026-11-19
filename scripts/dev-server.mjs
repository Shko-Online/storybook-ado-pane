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

// Serves build/web plus Storybook zips from .fixtures/ for the local harness.
//   http://localhost:5173/host.html  → viewer inside a frame from another site (like Azure DevOps)
//   http://localhost:5173/dev.html   → viewer as a top-level page
// Like the extension's CDN, it answers 404 for anything that is not a real file: the Storybook's
// own URLs (sb/s/…) only exist while the service worker serves them.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'build', 'web');
const fixtures = path.join(root, '.fixtures');
const port = Number(process.env.PORT) || 5173;
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.png': 'image/png',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/fixtures/') {
      const names = fs.existsSync(fixtures) ? fs.readdirSync(fixtures).filter((n) => n.endsWith('.zip')).sort() : [];
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(names));
      return;
    }
    let base;
    let rel;
    try {
      [base, rel] = url.pathname.startsWith('/fixtures/')
        ? [fixtures, decodeURIComponent(url.pathname.slice('/fixtures/'.length))]
        : [web, url.pathname === '/' ? 'host.html' : decodeURIComponent(url.pathname.slice(1))];
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    const file = path.join(base, rel);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const stat = fs.statSync(file);
    res.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Dev harness: http://localhost:${port}/host.html`));
