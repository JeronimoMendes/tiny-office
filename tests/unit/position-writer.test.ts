import { expect, it, vi } from 'vitest';
import { PositionWriter } from '../../apps/server/src/persistence/position-writer';

it('coalesces per-tick positions without writing each frame', async () => {
  const savePositions = vi.fn().mockResolvedValue(undefined),
    writer = new PositionWriter({ savePositions }, 'workspace');
  for (let x = 0; x < 20; x++) writer.mark({ id: 'alice', x, y: 10 });
  expect(savePositions).not.toHaveBeenCalled();
  await writer.flush();
  expect(savePositions).toHaveBeenCalledExactlyOnceWith('workspace', [
    { id: 'alice', x: 19, y: 10 },
  ]);
  await writer.flush();
  expect(savePositions).toHaveBeenCalledTimes(1);
});

it('retains newer positions arriving during a write and serializes concurrent flushes', async () => {
  let finish!: () => void;
  const savePositions = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const writer = new PositionWriter({ savePositions }, 'workspace');
  writer.mark({ id: 'alice', x: 1, y: 0 });
  const first = writer.flush();
  writer.mark({ id: 'alice', x: 2, y: 0 });
  const second = writer.flush(),
    third = writer.flush();
  expect(savePositions).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([first, second, third]);
  expect(savePositions).toHaveBeenCalledTimes(2);
  expect(savePositions.mock.calls[1][1]).toEqual([{ id: 'alice', x: 2, y: 0 }]);
});

it('retains a failed batch for retry', async () => {
  const savePositions = vi
    .fn()
    .mockRejectedValueOnce(new Error('DB unavailable'))
    .mockResolvedValue(undefined);
  const writer = new PositionWriter({ savePositions }, 'workspace');
  writer.mark({ id: 'alice', x: 3, y: 4 });
  await expect(writer.flush()).rejects.toThrow('DB unavailable');
  await writer.flush();
  expect(savePositions).toHaveBeenCalledTimes(2);
});
