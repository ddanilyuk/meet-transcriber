// Renders the extension icons (16/32/48/128 PNG) without dependencies: shapes are drawn with signed
// distance functions, supersampled for anti-aliasing and encoded with node:zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../extension/icons/', import.meta.url));
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor

const BG = [26, 115, 232]; // Google blue #1a73e8
const FG = [255, 255, 255];
const DOT = [238, 103, 92]; // recording red #ee675c

// Signed distance to a rounded rectangle centred at (cx, cy) with half-size (hw, hh) and radius r.
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Icon in a 0..1 coordinate space: blue squircle, three white "text" lines of a transcript, red live dot.
function sample(x, y) {
  if (sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.23) > 0) return null;
  if (Math.hypot(x - 0.76, y - 0.27) < 0.095) return DOT;
  const lines = [
    [0.22, 0.27, 0.56],
    [0.22, 0.5, 0.78],
    [0.22, 0.73, 0.64],
  ];
  for (const [x0, cy, x1] of lines) {
    if (sdRoundRect(x, y, (x0 + x1) / 2, cy, (x1 - x0) / 2, 0.055, 0.055) <= 0) return FG;
  }
  return BG;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const n = size * SS;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((pxl * SS + sx + 0.5) / n, (py * SS + sy + 0.5) / n);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const i = (py * size + pxl) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
      px[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  writeFileSync(`${OUT}icon-${size}.png`, png(size, render(size)));
  console.log(`icons/icon-${size}.png`);
}
