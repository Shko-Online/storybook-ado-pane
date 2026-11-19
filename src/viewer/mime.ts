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
 * Content types of the files of a Storybook, by extension. Browsers are strict about some
 * of them: a module script only runs when it is served as JavaScript, and WebAssembly only
 * compiles while streaming when it is served as `application/wasm`.
 */
const TYPES: Record<string, string> = {
  html: 'text/html;charset=utf-8',
  htm: 'text/html;charset=utf-8',
  css: 'text/css;charset=utf-8',
  js: 'text/javascript;charset=utf-8',
  mjs: 'text/javascript;charset=utf-8',
  cjs: 'text/javascript;charset=utf-8',
  json: 'application/json;charset=utf-8',
  map: 'application/json;charset=utf-8',
  webmanifest: 'application/manifest+json',
  wasm: 'application/wasm',
  txt: 'text/plain;charset=utf-8',
  log: 'text/plain;charset=utf-8',
  md: 'text/plain;charset=utf-8',
  mdx: 'text/plain;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  xml: 'application/xml;charset=utf-8',
  yaml: 'text/plain;charset=utf-8',
  yml: 'text/plain;charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  webm: 'video/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  vtt: 'text/vtt;charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf',
  zip: 'application/zip',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
};

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function mimeType(path: string): string {
  return TYPES[extensionOf(path)] ?? 'application/octet-stream';
}

export function isHtml(path: string): boolean {
  const ext = extensionOf(path);
  return ext === 'html' || ext === 'htm';
}
