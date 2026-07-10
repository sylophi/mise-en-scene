// Regenerates the example's checked-in assets:
//   src/tiles.png  - a 4-tile 16px spritesheet, written pixel by pixel
//   src/level.tmj  - the Tiled JSON level, authored as ASCII art below
// Run with: node scripts/generate.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (name) =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", name);

// ── Minimal PNG encoder (RGBA, no interlace) ─────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
};
const png = (width, height, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// ── The spritesheet: 4 tiles of 16x16 → 64x16 ────────────────────────────────
// 0 grass (solid)  1 dirt (solid)  2 stone (solid)  3 flag (goal, not solid)

const T = 16;
const W = T * 4;
const H = T;
const sheet = Buffer.alloc(W * H * 4);
const put = (x, y, [r, g, b, a = 255]) => {
  const i = (y * W + x) * 4;
  sheet[i] = r;
  sheet[i + 1] = g;
  sheet[i + 2] = b;
  sheet[i + 3] = a;
};
const speck = (x, y) => (x * 7 + y * 13) % 11 === 0;

for (let y = 0; y < T; y++) {
  for (let x = 0; x < T; x++) {
    // tile 0: grass — green top over dirt
    put(
      x,
      y,
      y < 4
        ? y === 0
          ? [122, 204, 91]
          : [86, 173, 66]
        : speck(x, y)
          ? [110, 74, 42]
          : [140, 96, 56],
    );
    // tile 1: dirt
    put(T + x, y, speck(x, y) ? [104, 70, 40] : [132, 90, 52]);
    // tile 2: stone bricks
    const mortar = y % 8 === 7 || (x + (y < 8 ? 0 : 4)) % 8 === 7;
    put(T * 2 + x, y, mortar ? [96, 100, 110] : [140, 146, 158]);
    // tile 3: flag — transparent, pole at x 7-8, pennant up top
    const pole = x >= 7 && x <= 8;
    const pennant = y >= 2 && y <= 7 && x > 8 && x <= 8 + (8 - y);
    put(
      T * 3 + x,
      y,
      pennant ? [240, 186, 48] : pole ? [90, 90, 98] : [0, 0, 0, 0],
    );
  }
}
writeFileSync(out("tiles.png"), png(W, H, sheet));

// ── The level: ASCII art → .tmj ──────────────────────────────────────────────
// G grass  D dirt  S stone  F flag  . empty      (40 x 14 tiles)

const ART = `
........................................
........................................
........................................
.....................................F..
....................................SSS.
........................................
................................SSS.....
............................SSS.........
..........SSS...........SSS.............
......SS................................
........................................
........................................
GGGGGGGGGGGGGGGG....GGGGGGGGGGGGGGGGGGGG
DDDDDDDDDDDDDDDD....DDDDDDDDDDDDDDDDDDDD
`
  .trim()
  .split("\n");

const GID = { G: 1, D: 2, S: 3, F: 4 };
const width = ART[0].length;
const height = ART.length;
for (const [i, row] of ART.entries()) {
  if (row.length !== width)
    throw new Error(`row ${i} is ${row.length} wide, expected ${width}`);
}
const data = ART.flatMap((row) => [...row].map((c) => GID[c] ?? 0));

const tmj = {
  type: "map",
  version: "1.10",
  tiledversion: "1.11.0",
  orientation: "orthogonal",
  renderorder: "right-down",
  infinite: false,
  width,
  height,
  tilewidth: T,
  tileheight: T,
  nextlayerid: 2,
  nextobjectid: 1,
  tilesets: [
    {
      firstgid: 1,
      name: "tiles",
      image: "tiles.png",
      imagewidth: W,
      imageheight: H,
      tilewidth: T,
      tileheight: T,
      columns: 4,
      tilecount: 4,
      margin: 0,
      spacing: 0,
      tiles: [
        { id: 0, properties: [{ name: "solid", type: "bool", value: true }] },
        { id: 1, properties: [{ name: "solid", type: "bool", value: true }] },
        { id: 2, properties: [{ name: "solid", type: "bool", value: true }] },
        // id 3, the flag, is the goal — not solid
      ],
    },
  ],
  layers: [
    {
      id: 1,
      type: "tilelayer",
      name: "terrain",
      visible: true,
      opacity: 1,
      x: 0,
      y: 0,
      width,
      height,
      data,
    },
  ],
};
writeFileSync(out("level.tmj"), JSON.stringify(tmj, null, 2) + "\n");

console.log(
  `wrote src/tiles.png (${W}x${H}) and src/level.tmj (${width}x${height})`,
);
