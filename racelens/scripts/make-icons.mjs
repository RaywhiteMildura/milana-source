#!/usr/bin/env node
/**
 * Generates the PWA icons under src/web/public/icons without any npm
 * dependency: a tiny PNG encoder (zlib deflate from node:zlib + CRC32) and a
 * supersampled rasteriser for the RaceLens mark (green rounded square, gold
 * ring, white centre dot) – the same geometry as the inline SVG logo.
 *
 *   node scripts/make-icons.mjs
 *
 * Outputs:
 *   icon-192.png, icon-512.png            rounded square, transparent corners (purpose "any")
 *   icon-maskable-192.png, -512.png       full-bleed green, mark inside the 80% safe zone (purpose "maskable")
 *   apple-touch-icon.png                  180px full-bleed (iOS applies its own rounding)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../src/web/public/icons');

const GREEN = [0x0f, 0x6b, 0x4f];
const GOLD = [0xf3, 0xc7, 0x5a];
const WHITE = [0xff, 0xff, 0xff];

// ------------------------------------------------------------------ CRC32
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------- PNG
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Encode 8-bit RGBA pixels (row-major, 4 bytes per pixel) as a PNG. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none) for this scanline
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------- rasteriser
/**
 * Draw the mark at `size` px. In the 64-unit logo space the square has rx=14,
 * the ring is centred with radius 15 and stroke 6 (so it spans r 12..18) and
 * the dot has r=5. `scale` shrinks the ring and dot towards the centre (used
 * for the maskable variants so the mark sits inside the 80% safe zone).
 */
function drawMark(size, { rounded, scale = 1, samples = 4 }) {
  const rgba = Buffer.alloc(size * size * 4);
  const unit = size / 64;
  const cx = size / 2;
  const cy = size / 2;
  const rx = 14 * unit;
  const ringOuter = 18 * unit * scale;
  const ringInner = 12 * unit * scale;
  const dot = 5 * unit * scale;
  const inRoundedSquare = (x, y) => {
    // Distance-based test for a rounded rectangle covering the whole canvas.
    const dx = Math.max(Math.abs(x - cx) - (size / 2 - rx), 0);
    const dy = Math.max(Math.abs(y - cy) - (size / 2 - rx), 0);
    return dx * dx + dy * dy <= rx * rx;
  };
  const step = 1 / samples;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          if (rounded && !inRoundedSquare(x, y)) continue; // transparent corner
          const d = Math.hypot(x - cx, y - cy);
          let c = GREEN;
          if (d <= dot) c = WHITE;
          else if (d >= ringInner && d <= ringOuter) c = GOLD;
          a += 1;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (py * size + px) * 4;
      if (a === 0) continue; // fully transparent pixel
      rgba[i] = Math.round(r / a);
      rgba[i + 1] = Math.round(g / a);
      rgba[i + 2] = Math.round(b / a);
      rgba[i + 3] = Math.round((a / (samples * samples)) * 255);
    }
  }
  return rgba;
}

const outputs = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  // Maskable: the OS crops to its own shape, so fill the canvas and keep the mark within the central 80%.
  { file: 'icon-maskable-192.png', size: 192, rounded: false, scale: 0.8 },
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.8 },
  // iOS ignores transparency and rounds the corners itself.
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.9 },
];

fs.mkdirSync(outDir, { recursive: true });
for (const o of outputs) {
  const png = encodePng(o.size, o.size, drawMark(o.size, { rounded: o.rounded, scale: o.scale ?? 1 }));
  fs.writeFileSync(path.join(outDir, o.file), png);
  console.log(`wrote ${path.relative(process.cwd(), path.join(outDir, o.file))} (${o.size}px, ${png.length} bytes)`);
}
