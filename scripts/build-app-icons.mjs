import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

// 외부 이미지·폰트·설치 도구 없이 단순한 자물쇠 아이콘을 만듭니다.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([size, name, bytes, crc]);
}
function icon(size) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  const rect = (x, y, left, top, width, height) => x >= left && x <= left + width && y >= top && y <= top + height;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const x = (column + 0.5) * 512 / size;
      const y = (row + 0.5) * 512 / size;
      let color = [16, 26, 40];
      const distance = Math.hypot(x - 256, y - 192);
      if ((y <= 192 && distance >= 50 && distance <= 78)
          || rect(x, y, 178, 192, 28, 48) || rect(x, y, 306, 192, 28, 48)) color = [236, 244, 255];
      const cx = Math.max(172, Math.min(x, 340));
      const cy = Math.max(254, Math.min(y, 372));
      if (rect(x, y, 144, 226, 224, 174) && Math.hypot(x - cx, y - cy) <= 28) color = [138, 216, 223];
      if (Math.hypot(x - 256, y - 302) <= 18 || rect(x, y, 249, 302, 14, 44)) color = [16, 26, 40];
      const offset = row * (1 + size * 3) + 1 + column * 3;
      raw.set(color, offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const output = resolve(import.meta.dirname, '../public/icons');
mkdirSync(output, { recursive: true });
for (const size of [192, 512]) writeFileSync(resolve(output, `vault-${size}.png`), icon(size));
process.stdout.write('자료실 앱 아이콘 192·512 생성\n');
