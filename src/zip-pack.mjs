/**
 * 宠物资源包用的 zip。只支持存档和 deflate，并拒绝带 .. 的路径。
 */
import { createWriteStream, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRaw, inflateRawSync } from 'node:zlib';
import { promisify } from 'node:util';

const deflateRawAsync = promisify(deflateRaw);
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

export function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walkFiles(dir, base, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (entry.isDirectory()) walkFiles(abs, base, out);
    else if (entry.isFile()) out.push({ abs, rel });
  }
}

function writeAll(stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

export async function zipDirectory(dir, dest) {
  const files = [];
  walkFiles(dir, dir, files);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  mkdirSync(path.dirname(dest), { recursive: true });
  const out = createWriteStream(dest);
  let offset = 0;
  const central = [];
  for (const file of files) {
    const body = readFileSync(file.abs);
    const name = Buffer.from(file.rel, 'utf8');
    const compressed = await deflateRawAsync(body);
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    await writeAll(out, local);
    await writeAll(out, name);
    await writeAll(out, compressed);
    central.push({ name, crc, compressed: compressed.length, size: body.length, offset });
    offset += local.length + name.length + compressed.length;
  }
  const centralStart = offset;
  for (const item of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(item.crc, 16);
    header.writeUInt32LE(item.compressed, 20);
    header.writeUInt32LE(item.size, 24);
    header.writeUInt16LE(item.name.length, 28);
    header.writeUInt32LE(item.offset, 42);
    await writeAll(out, header);
    await writeAll(out, item.name);
    offset += header.length + item.name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  await writeAll(out, eocd);
  await new Promise((resolve, reject) => {
    out.on('error', reject);
    out.end(resolve);
  });
}

export function safeZipPath(name) {
  const rel = String(name || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) return '';
  const parts = rel.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) {
    throw new Error('压缩包包含不安全路径');
  }
  return parts.join('/');
}

export function extractZip(buffer, dest) {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || ptr === 0xffffffff) throw new Error('不支持这种 zip');
  mkdirSync(dest, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) throw new Error('压缩包目录损坏');
    const method = buffer.readUInt16LE(ptr + 10);
    const crc = buffer.readUInt32LE(ptr + 16);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const size = buffer.readUInt32LE(ptr + 24);
    const nameLength = buffer.readUInt16LE(ptr + 28);
    const extraLength = buffer.readUInt16LE(ptr + 30);
    const commentLength = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const rawName = buffer.subarray(ptr + 46, ptr + 46 + nameLength).toString('utf8');
    ptr += 46 + nameLength + extraLength + commentLength;
    if (!rawName || rawName.endsWith('/')) continue;
    const rel = safeZipPath(rawName);
    if (!rel) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error('不支持的压缩方式');
    if (size !== 0xffffffff && data.length !== size) throw new Error('压缩包大小不对：' + rel);
    if (crc32(data) !== crc) throw new Error('压缩包校验失败：' + rel);
    const target = path.join(dest, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('不是有效的 zip');
}

export function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(abs);
    else if (entry.isFile()) total += statSync(abs).size;
  }
  return total;
}
