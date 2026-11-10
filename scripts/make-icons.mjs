// Renders the extension icons (16/32/48/96/128/256 PNG) from the master artwork `design/icon-source.png` without
// dependencies: the source PNG is decoded with node:zlib, cropped to its opaque content, scaled down with an
// area (box) filter in premultiplied alpha and encoded again. Chrome's guideline for the 128 px icon is 96 px of
// artwork with 16 px of transparent padding; the small toolbar sizes use (almost) the whole square to stay legible.
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../design/icon-source.png', import.meta.url));
const OUT = fileURLToPath(new URL('../extension/icons/', import.meta.url));
// Transparent margin per side, px. 96 is the 2× of 48 (chrome://extensions on a Retina screen upscaled the 48 px
// bitmap and looked blurry next to other extensions) and keeps 48's framing; 256 keeps 128's framing for the
// install dialog and high zoom levels.
const PADDING = { 16: 0, 32: 1, 48: 2, 96: 4, 128: 16, 256: 32 };
const ALPHA_CUTOFF = 16; // pixels at or below this alpha do not count as content when cropping

// ---------- PNG decode (8-bit RGBA or RGB, non-interlaced) ----------

function decodePng(buf) {
  let width, height, depth, colorType, interlace;
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      [depth, colorType] = [data[8], data[9]];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || (colorType !== 6 && colorType !== 2) || interlace) {
    throw new Error(`unsupported PNG: depth ${depth}, color type ${colorType}, interlace ${interlace}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (line[x] + pred) & 0xff;
    }
  }
  if (bpp === 4) return { width, height, px };
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) px.copy(rgba, i * 4, i * 3, i * 3 + 3);
  return { width, height, px: rgba };
}

// ---------- crop + area resample ----------

function contentBox({ width, height, px }) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > ALPHA_CUTOFF) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('the source icon is fully transparent');
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Weights of source pixels covering each destination pixel along one axis (exact fractional coverage).
function axisWeights(srcStart, srcLen, dstLen) {
  const scale = srcLen / dstLen;
  return Array.from({ length: dstLen }, (_, d) => {
    const a = srcStart + d * scale;
    const b = a + scale;
    const taps = [];
    for (let s = Math.floor(a); s < Math.ceil(b); s++) {
      const w = Math.min(b, s + 1) - Math.max(a, s);
      if (w > 0) taps.push([s, w / scale]);
    }
    return taps;
  });
}

// Draws the source box scaled to `dw`×`dh` at (dx, dy) of a transparent `size`×`size` canvas.
function render(src, box, size) {
  const pad = PADDING[size];
  const fit = Math.min((size - 2 * pad) / box.w, (size - 2 * pad) / box.h);
  const dw = Math.max(1, Math.round(box.w * fit));
  const dh = Math.max(1, Math.round(box.h * fit));
  const dx = Math.floor((size - dw) / 2);
  const dy = Math.floor((size - dh) / 2);
  const wx = axisWeights(box.x0, box.w, dw);
  const wy = axisWeights(box.y0, box.h, dh);

  // Horizontal pass into premultiplied floats (rows of the crop only), then vertical pass.
  const tmp = new Float64Array(dw * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    const row = (box.y0 + y) * src.width;
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [s, w] of wx[x]) {
        const i = (row + s) * 4;
        const al = (src.px[i + 3] / 255) * w;
        r += src.px[i] * al; g += src.px[i + 1] * al; b += src.px[i + 2] * al; a += al;
      }
      const t = (y * dw + x) * 4;
      tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b; tmp[t + 3] = a;
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [s, w] of wy[y]) {
        const t = ((s - box.y0) * dw + x) * 4;
        r += tmp[t] * w; g += tmp[t + 1] * w; b += tmp[t + 2] * w; a += tmp[t + 3] * w;
      }
      const o = ((dy + y) * size + dx + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  return out;
}

// ---------- PNG encode ----------

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
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const src = decodePng(readFileSync(SOURCE));
const box = contentBox(src);
console.log(`source ${src.width}×${src.height}, artwork ${box.w}×${box.h} at ${box.x0},${box.y0}`);
mkdirSync(OUT, { recursive: true });
for (const size of Object.keys(PADDING).map(Number)) {
  writeFileSync(`${OUT}icon-${size}.png`, png(size, render(src, box, size)));
  console.log(`icons/icon-${size}.png`);
}
