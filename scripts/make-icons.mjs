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

// Generates the extension and task icons (PNG) without external tools.
// A rounded tile with a book and a bookmark ribbon. (The Marketplace does not accept SVG.)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const SS = 4; // supersampling for anti-aliased edges
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const p = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0; raw[o + 1] = a ? Math.round(g / a) : 0; raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const roundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const TILE = [24, 98, 84], COVER = [255, 255, 255], SPINE = [176, 196, 192], RIBBON = [228, 0, 70], NONE = [0, 0, 0, 0];
function icon(x, y) {
  if (!roundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.18)) return NONE;
  // Bookmark ribbon, hanging over the top edge of the cover, with a notch at its end.
  if (x > 0.56 && x < 0.68 && y > 0.14 && y < 0.42 + (0.07 * Math.abs(x - 0.62)) / 0.06) return [...RIBBON, 1];
  if (roundRect(x, y, 0.24, 0.2, 0.76, 0.84, 0.05)) {
    if (x < 0.33) return [...SPINE, 1];
    // Two lines of a story.
    for (const [ly, end] of [[0.6, 0.66], [0.71, 0.58]]) if (y > ly - 0.025 && y < ly + 0.025 && x > 0.41 && x < end) return [...SPINE, 1];
    return [...COVER, 1];
  }
  return [...TILE, 1];
}

fs.mkdirSync(path.join(root, 'images'), { recursive: true });
fs.writeFileSync(path.join(root, 'images', 'icon.png'), png(128, icon));
fs.writeFileSync(path.join(root, 'tasks', 'PublishStorybook', 'icon.png'), png(32, icon));
console.log('Icons written.');
