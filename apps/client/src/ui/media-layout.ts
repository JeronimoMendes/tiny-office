/** Balanced, full-width rows, chosen to keep faces close to a 16:10 tile. */
export function callRows(count: number, width: number, height: number, gap: number): number[] {
  if (count <= 0 || width <= 0 || height <= 0) return [];
  let best: number[] = [];
  let bestScore = Infinity;
  for (let rows = 1; rows <= count; rows++) {
    const tileHeight = (height - gap * (rows - 1)) / rows;
    if (tileHeight <= 0) break;
    const columns = Array.from(
      { length: rows },
      (_, row) => Math.floor(count / rows) + (row < count % rows ? 1 : 0),
    );
    let score = 0;
    for (const n of columns) {
      const tileWidth = (width - gap * (n - 1)) / n;
      // Log distance treats excessively tall and wide tiles symmetrically.
      score += n * Math.abs(Math.log(Math.max(tileWidth, 0) / tileHeight / (16 / 10)));
    }
    if (score < bestScore) {
      best = columns;
      bestScore = score;
    }
  }
  return best;
}

export type PinnedLayout = { stage: number; strip: { width: number; height: number } };

/** A pinned screen keeps the panel; the faces ride under it in one short strip. */
export function pinnedLayout(
  count: number,
  width: number,
  height: number,
  gap: number,
): PinnedLayout {
  const empty = { width: 0, height: 0 };
  if (width <= 0 || height <= 0) return { stage: 0, strip: empty };
  if (count <= 0) return { stage: height, strip: empty };
  const fits = ((width - gap * (count - 1)) / count) * (10 / 16);
  const tile = Math.max(Math.min(height * 0.15, 120, fits), 0);
  return { stage: height - gap - tile, strip: { width: tile * (16 / 10), height: tile } };
}
