import type { SavedPosition, Store } from './store';

// Serialized writes, coalesced by user. A failed batch remains dirty; a newer
// position arriving during a write is never cleared by the older batch.
export class PositionWriter {
  private dirty = new Map<string, SavedPosition>();
  private running: Promise<void> | null = null;
  constructor(
    private store: Pick<Store, 'savePositions'>,
    private workspaceId: string,
  ) {}
  mark(position: SavedPosition) {
    this.dirty.set(position.id, { id: position.id, x: position.x, y: position.y });
  }
  async flush(): Promise<void> {
    while (this.running) await this.running;
    if (!this.dirty.size) return;
    const batch = [...this.dirty.values()];
    const write = this.store.savePositions(this.workspaceId, batch).then(() => {
      for (const p of batch) if (this.dirty.get(p.id) === p) this.dirty.delete(p.id);
    });
    this.running = write;
    try {
      await write;
    } finally {
      if (this.running === write) this.running = null;
    }
  }
}
