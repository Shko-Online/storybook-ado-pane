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

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

/**
 * Writes the files of a folder into one zip archive.
 *
 * A Storybook build is many small files, and Azure DevOps handles an artifact file by file:
 * uploading a thousand of them takes minutes, and so does downloading them again as an
 * archive. One zip is uploaded and downloaded in seconds.
 *
 * Files are added one after the other, so no more than one is open or in memory at a time,
 * however many there are. The archive is a plain zip (no Zip64), which holds up to 65,535
 * files and 4 GB; a Storybook beyond that cannot be shown in a browser tab anyway.
 */

/** A file to add: its path in the archive (POSIX style) and where to read it from. */
export interface ZipSource {
  path: string;
  file: string;
}

const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

/** Already compressed formats: deflating them again only costs time. */
const STORED = /\.(png|jpe?g|gif|webp|avif|ico|webm|mp4|m4v|mov|mp3|m4a|ogg|oga|ogv|flac|zip|gz|br|woff2?|pdf)$/i;

/** Creates `target` with `sources` in it. Returns the size of the archive in bytes. */
export function writeZip(target: string, sources: ZipSource[]): number {
  if (sources.length > MAX_ENTRIES) {
    throw new Error(`The folder has ${sources.length} files; one archive holds ${MAX_ENTRIES} at most.`);
  }

  const out = fs.openSync(target, 'w');
  try {
    let offset = 0;
    const write = (chunk: Buffer) => {
      fs.writeSync(out, chunk);
      offset += chunk.length;
      if (offset > MAX_SIZE) throw new Error('The folder is too large to publish: the archive would exceed 4 GB.');
    };

    const directory: Buffer[] = [];
    for (const source of sources) {
      const content = fs.readFileSync(source.file);
      if (content.length > MAX_SIZE) throw new Error(`${source.path} is too large to publish (over 4 GB).`);
      const name = Buffer.from(source.path, 'utf8');
      const deflated = STORED.test(source.path) || content.length === 0 ? undefined : zlib.deflateRawSync(content, { level: 6 });
      // Keep the deflated form only when it is actually smaller.
      const data = deflated && deflated.length < content.length ? deflated : content;
      const method = data === content ? 0 : 8;
      const [time, date] = dosTime(fs.statSync(source.file).mtime);
      const crc = crc32(content);
      const at = offset;

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); // local file header
      local.writeUInt16LE(20, 4); // version needed: 2.0
      local.writeUInt16LE(0x0800, 6); // names are UTF-8
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(content.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28); // no extra field
      write(local);
      write(name);
      write(data);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0); // central directory header
      central.writeUInt16LE(20, 4); // made by: 2.0
      central.writeUInt16LE(20, 6); // version needed: 2.0
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(method, 10);
      central.writeUInt16LE(time, 12);
      central.writeUInt16LE(date, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(content.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(at, 42); // offset of the local header; the fields between stay 0
      directory.push(central, name);
    }

    const directoryAt = offset;
    for (const part of directory) write(part);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); // end of central directory
    end.writeUInt16LE(sources.length, 8);
    end.writeUInt16LE(sources.length, 10);
    end.writeUInt32LE(offset - directoryAt, 12);
    end.writeUInt32LE(directoryAt, 16);
    write(end);
    return offset;
  } finally {
    fs.closeSync(out);
  }
}

/** All files under `root`, sorted, as paths for {@link writeZip}. */
export function listFolder(root: string): ZipSource[] {
  const out: ZipSource[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      const abs = path.join(dir, dirent.name);
      if (dirent.isDirectory()) walk(abs, rel);
      else if (dirent.isFile()) out.push({ path: rel, file: abs });
      // A build may link a file instead of copying it. Linked folders are not followed: they can loop.
      else if (dirent.isSymbolicLink() && isFile(abs)) out.push({ path: rel, file: abs });
    }
  };
  walk(root, '');
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false; // a dangling link
  }
}

/** Time and date in the format of a zip entry (local time, two-second steps, from 1980). */
function dosTime(when: Date): [number, number] {
  const year = Math.min(Math.max(when.getFullYear(), 1980), 2107);
  return [
    (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  ];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of a buffer. (zlib.crc32 exists only from Node 20.15; the task also runs on Node 16.) */
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
