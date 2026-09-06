import {
  appearanceFrames,
  presetAppearance,
  type Appearance,
  type Direction,
} from '@office/shared';
const directions: Direction[] = ['down', 'left', 'right', 'up'];

export function Avatar({
  character = 0,
  appearance,
  scale = 1,
  direction = 'down',
}: {
  character?: number;
  appearance?: Appearance | null;
  scale?: number;
  direction?: Direction;
}) {
  const width = 24 * scale,
    height = 32 * scale;
  return (
    <span className="avatar-chip" style={{ width, height }} aria-hidden="true">
      {appearanceFrames(appearance ?? presetAppearance(character)).map(({ name, row, rows }) => (
        <span
          key={name}
          style={{
            backgroundImage: `url('/assets/wardrobe/${name}.png')`,
            backgroundSize: `${width * 12}px ${height * rows}px`,
            backgroundPosition: `-${width * (directions.indexOf(direction) * 3 + 1)}px -${row * height}px`,
          }}
        />
      ))}
    </span>
  );
}
