import type { SpriteSheetSpec } from "@mise/react";

export const WALK_SHEET: SpriteSheetSpec = {
  src: "/assets/player-walk.png",
  columns: 6,
  rows: 1,
};

export const IDLE_SHEET: SpriteSheetSpec = {
  src: "/assets/player-idle.png",
  columns: 4,
  rows: 1,
};

export const COIN_SHEET: SpriteSheetSpec = {
  src: "/assets/coin.png",
  columns: 6,
  rows: 1,
};

export const GRASS_URL = "/assets/grass.png";
export const TREE_URL = "/assets/tree.png";
export const HEART_URL = "/assets/heart.png";

/** Everything the loading screen waits for. */
export const ASSET_URLS: readonly string[] = [
  WALK_SHEET.src,
  IDLE_SHEET.src,
  COIN_SHEET.src,
  GRASS_URL,
  TREE_URL,
  HEART_URL,
];
