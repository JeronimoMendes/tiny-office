// One idle frame lifted out of the walk sheet. The artwork is four times the
// world grid, so the sheet is scaled down rather than magnified.
const FRAME = { width: 24, height: 32 };
const SHEET = { columns: 12, rows: 8, idle: 1 };

export function Avatar({ character, scale = 1 }: { character: number; scale?: number }) {
  const width = FRAME.width * scale,
    height = FRAME.height * scale;
  return (
    <span
      className="avatar-chip"
      style={{
        width,
        height,
        backgroundSize: `${width * SHEET.columns}px ${height * SHEET.rows}px`,
        backgroundPosition: `-${width * SHEET.idle}px -${character * height}px`,
      }}
      aria-hidden="true"
    />
  );
}
