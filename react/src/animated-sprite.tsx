import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ReactNode } from "react";
import {
  useSpriteAnimation,
  type SpriteAnimationOptions,
} from "./sprite-animation.ts";

/** A spritesheet: one image holding a row-major grid of equal-size cells. */
export interface SpriteSheetSpec {
  src: string;
  /** Grid size in cells. Give `columns` + `rows`… */
  columns?: number;
  rows?: number;
  /**
   * …or the cell size in *source pixels*; the grid is then measured from the
   * image's natural size (instant when the image was preloaded).
   */
  frameWidth?: number;
  frameHeight?: number;
}

export interface AnimatedSpriteProps extends Omit<
  SpriteAnimationOptions,
  "frameCount"
> {
  /** Spritesheet mode: one image, a grid of cells. */
  sheet?: SpriteSheetSpec;
  /** Multi-image mode: one image url per frame. Preload for flicker-free swaps. */
  images?: readonly string[];
  /**
   * Which cells make up the clip: an index array into the grid (row-major) or
   * image list, or a count from cell 0. Default: every cell.
   */
  frames?: number | readonly number[];
  /** Rendered width in camera units. */
  width: number;
  /** Rendered height in camera units. */
  height: number;
  /** Crisp nearest-neighbor upscaling (pixel art). Default true. */
  pixelated?: boolean;
  className?: string;
  /** Merged last, so it can override anything (e.g. `transform` to center). */
  style?: CSSProperties;
}

interface Grid {
  columns: number;
  rows: number;
}

/** Resolve the sheet grid: explicit columns/rows, or measured from the image. */
function useSheetGrid(sheet: SpriteSheetSpec | undefined): Grid | null {
  const src = sheet?.src;
  const { columns, rows, frameWidth, frameHeight } = sheet ?? {};
  const explicit =
    columns !== undefined && rows !== undefined ? { columns, rows } : null;
  const hasExplicit = explicit !== null;
  const [measured, setMeasured] = useState<(Grid & { src: string }) | null>(
    null,
  );

  useEffect(() => {
    if (!src || hasExplicit) return;
    if (frameWidth === undefined || frameHeight === undefined) return;
    let cancelled = false;
    const img = new Image();
    img.addEventListener(
      "load",
      () => {
        if (cancelled) return;
        setMeasured({
          src,
          columns: Math.max(1, Math.floor(img.naturalWidth / frameWidth)),
          rows: Math.max(1, Math.floor(img.naturalHeight / frameHeight)),
        });
      },
      { once: true },
    );
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, hasExplicit, frameWidth, frameHeight]);

  if (explicit) return explicit;
  return measured && measured.src === src ? measured : null;
}

function resolveCells(
  frames: number | readonly number[] | undefined,
  cellCount: number,
): readonly number[] {
  const count = typeof frames === "number" ? frames : cellCount;
  if (frames !== undefined && typeof frames !== "number") return frames;
  return Array.from({ length: Math.max(0, count) }, (_, i) => i);
}

/**
 * A sprite frame-flipper sized in camera units and driven by *engine* time
 * (via {@link useSpriteAnimation}): it pauses when the game does. Two sources:
 *
 * ```tsx
 * <AnimatedSprite sheet={{ src, columns: 6, rows: 1 }} fps={10} width={8} height={8} />
 * <AnimatedSprite images={frames} fps={10} width={8} height={8} />
 * ```
 *
 * Spritesheet cells render via `background-position` authored entirely in
 * camera units (`var(--u)`), so resizing stays a pure CSS reflow. The element
 * draws with its top-left at the unit origin, like everything else; pass
 * `style={{ transform: "translate(-50%, -50%)" }}` to center it.
 */
export function AnimatedSprite({
  sheet,
  images,
  frames,
  fps,
  loop,
  playing,
  onFinished,
  width,
  height,
  pixelated = true,
  className,
  style,
}: AnimatedSpriteProps): ReactNode {
  const grid = useSheetGrid(sheet);
  const cellCount = images
    ? images.length
    : grid
      ? grid.columns * grid.rows
      : 0;
  const cells = useMemo(
    () => resolveCells(frames, cellCount),
    [frames, cellCount],
  );

  const anim = useSpriteAnimation({
    frameCount: cells.length,
    fps,
    loop,
    playing,
    onFinished,
  });
  // Clamp: a source swap (walk sheet -> idle sheet) can briefly leave the
  // clip's frame beyond the new, shorter cell list.
  const cell = cells[Math.min(anim.frame, cells.length - 1)] ?? 0;

  const base: CSSProperties = {
    width: `calc(${width} * var(--u))`,
    height: `calc(${height} * var(--u))`,
    imageRendering: pixelated ? "pixelated" : undefined,
  };

  if (images) {
    return (
      <img
        src={images[cell] ?? images[0]}
        alt=""
        draggable={false}
        className={className}
        style={{ ...base, ...style }}
      />
    );
  }

  if (sheet && grid) {
    const col = cell % grid.columns;
    const row = Math.floor(cell / grid.columns);
    return (
      <div
        className={className}
        style={{
          ...base,
          backgroundImage: `url(${sheet.src})`,
          backgroundSize:
            `calc(${width * grid.columns} * var(--u)) ` +
            `calc(${height * grid.rows} * var(--u))`,
          backgroundPosition:
            `calc(${-col * width} * var(--u)) ` +
            `calc(${-row * height} * var(--u))`,
          ...style,
        }}
      />
    );
  }

  // Sheet grid still being measured (or no source given): hold the box.
  return <div className={className} style={{ ...base, ...style }} />;
}
