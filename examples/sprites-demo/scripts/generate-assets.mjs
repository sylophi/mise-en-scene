// Generates the demo's PNG spritesheets from code (no copyrighted art, no
// image dependencies: a minimal PNG encoder over node:zlib). Regenerate with
//   pnpm --filter sprites-demo generate-assets
// The outputs are checked in under public/assets/.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "assets",
);
mkdirSync(OUT, { recursive: true });

// ── PNG encoding (8-bit RGBA, no filtering) ──────────────────────────────────

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height); // +1 filter byte per row
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Tiny framebuffer ─────────────────────────────────────────────────────────

class Img {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  px(x, y, [r, g, b, a = 255]) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }
  save(name) {
    writeFileSync(join(OUT, name), encodePng(this.w, this.h, this.data));
    console.log(`wrote ${name} (${this.w}x${this.h})`);
  }
}

// ── Palette ──────────────────────────────────────────────────────────────────

const SKIN = [242, 201, 160];
const HAIR = [85, 52, 31];
const SHIRT = [61, 109, 224];
const SHIRT_DARK = [42, 78, 168];
const PANTS = [52, 64, 107];
const SHOE = [30, 30, 36];
const GOLD = [245, 197, 66];
const GOLD_DARK = [184, 134, 11];
const GOLD_LIGHT = [255, 236, 160];
const GREEN = [72, 140, 68];
const GREEN_DARK = [52, 106, 50];
const TRUNK = [110, 74, 46];
const RED = [214, 60, 74];
const RED_DARK = [150, 34, 46];

// ── Player (16x16 cells) ─────────────────────────────────────────────────────

/** Head + torso + arms at cell (cx, 0..), bobbed down by `bob` px. */
function drawBody(img, cx, bob, armL, armR) {
  img.rect(cx + 5, 1 + bob, 6, 5, SKIN); // head
  img.rect(cx + 5, 1 + bob, 6, 2, HAIR); // hair
  img.px(cx + 9, 4 + bob, SHOE); // eye (faces right)
  img.rect(cx + 5, 6 + bob, 6, 5, SHIRT); // torso
  img.rect(cx + 5, 10 + bob, 6, 1, SHIRT_DARK); // belt shadow
  img.rect(cx + 4, 6 + bob + armL, 1, 3, SKIN); // left arm
  img.rect(cx + 11, 6 + bob + armR, 1, 3, SKIN); // right arm
}

function drawLeg(img, cx, x, y, h) {
  img.rect(cx + x, y, 2, h, PANTS);
  img.rect(cx + x, y + h, 2, 1, SHOE);
}

// Walk: 6 frames, legs scissor, arms counter-swing, slight bob mid-stride.
{
  const img = new Img(16 * 6, 16);
  const legA = [0, 1, 2, 1, 0, -1]; // front leg x-offset per frame
  const bob = [0, 1, 0, 0, 1, 0];
  for (let f = 0; f < 6; f++) {
    const cx = f * 16;
    drawBody(img, cx, bob[f], legA[f], -legA[f]);
    drawLeg(img, cx, 5 + legA[f], 11 + bob[f], 3 - bob[f]);
    drawLeg(img, cx, 9 - legA[f], 11 + bob[f], 3 - bob[f]);
  }
  img.save("player-walk.png");
}

// Idle: 4 frames, a slow breathing bob.
{
  const img = new Img(16 * 4, 16);
  const bob = [0, 0, 1, 1];
  for (let f = 0; f < 4; f++) {
    const cx = f * 16;
    drawBody(img, cx, bob[f], 0, 0);
    drawLeg(img, cx, 5, 11 + bob[f], 3 - bob[f]);
    drawLeg(img, cx, 9, 11 + bob[f], 3 - bob[f]);
  }
  img.save("player-idle.png");
}

// ── Coin: 6 frames, a disc spinning about its vertical axis ─────────────────

{
  const img = new Img(16 * 6, 16);
  const halfWidths = [6, 4, 2, 1, 2, 4];
  for (let f = 0; f < 6; f++) {
    const cx = f * 16 + 8;
    const hw = halfWidths[f];
    for (let dy = -6; dy <= 6; dy++) {
      const dx = Math.round(hw * Math.sqrt(Math.max(0, 1 - (dy / 6) ** 2)));
      for (let x = -dx; x <= dx; x++) {
        const edge = Math.abs(x) === dx || Math.abs(dy) === 6;
        img.px(cx + x, 8 + dy, edge ? GOLD_DARK : GOLD);
      }
    }
    if (hw >= 4) {
      img.px(cx - hw + 2, 5, GOLD_LIGHT); // glint
      img.px(cx - hw + 2, 6, GOLD_LIGHT);
    }
  }
  img.save("coin.png");
}

// ── Decor ────────────────────────────────────────────────────────────────────

// Grass tuft, 16x16.
{
  const img = new Img(16, 16);
  for (let i = 0; i < 7; i++) {
    const x = 2 + i * 2;
    const h = 3 + ((i * 5) % 4);
    img.rect(x, 15 - h, 1, h, i % 2 ? GREEN : GREEN_DARK);
  }
  img.save("grass.png");
}

// Tree, 24x32.
{
  const img = new Img(24, 32);
  img.rect(10, 20, 4, 11, TRUNK);
  for (let dy = -9; dy <= 9; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      const d = (dx / 10) ** 2 + (dy / 9) ** 2;
      if (d <= 1) {
        img.px(12 + dx, 11 + dy, d > 0.72 ? GREEN_DARK : GREEN);
      }
    }
  }
  img.save("tree.png");
}

// Heart, 16x16 (from a string bitmap).
{
  const rows = [
    "................",
    "...##.....##....",
    "..####...####...",
    ".#############..",
    ".#############..",
    ".#############..",
    "..###########...",
    "...#########....",
    "....#######.....",
    ".....#####......",
    "......###.......",
    ".......#........",
    "................",
  ];
  const img = new Img(16, 16);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "#") {
        img.px(x, y + 1, y <= 4 && x <= 6 ? RED : x > 9 ? RED_DARK : RED);
      }
    }
  });
  img.save("heart.png");
}
