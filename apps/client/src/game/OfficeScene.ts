import Phaser from 'phaser';
import { heading, parseMap, STEP_MS, type Direction, type Player } from '@office/shared';
import type { RendererBridge, RenderSnapshot } from '../session/bridge';

type Sample = { time: number; player: Player };
type Avatar = {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  shadow: Phaser.GameObjects.Ellipse;
  indicator: Phaser.GameObjects.Arc;
  samples: Sample[];
  target: Player;
};
const directions: Direction[] = ['down', 'left', 'right', 'up'];
const statusColors = { free: 0x9ebc8d, focus: 0xe2bd71, 'do-not-disturb': 0xce8174 };

export class OfficeScene extends Phaser.Scene {
  private snapshot: RenderSnapshot;
  private avatars = new Map<string, Avatar>();
  private zoneLabels = new Map<string, Phaser.GameObjects.Text>();
  private unsubscribe?: () => void;
  private keys = new Map<string, Direction>();
  private lastTick = -1;
  private renderTime = 0;
  private lastRevision: string;
  private zones;
  constructor(
    private bridge: RendererBridge,
    initial: RenderSnapshot,
  ) {
    super('office');
    this.snapshot = initial;
    this.lastRevision = initial.workspace.mapRevision;
    this.zones = parseMap(initial.workspace.map).zones;
  }
  preload() {
    this.load.image(
      'office-tiles',
      `/assets/${this.snapshot.workspace.map.tilesets[0].image.split('/').pop()}`,
    );
    this.load.spritesheet('avatars', '/assets/avatars.png', { frameWidth: 24, frameHeight: 32 });
  }
  create() {
    const parsed = parseMap(this.snapshot.workspace.map);
    this.cache.tilemap.add('office-map', {
      format: Phaser.Tilemaps.Formats.TILED_JSON,
      data: this.snapshot.workspace.map,
    });
    const map = this.make.tilemap({ key: 'office-map' });
    const tiles = map.addTilesetImage(parsed.tiled.tilesets[0].name, 'office-tiles')!;
    for (const layer of parsed.tiled.layers)
      if (layer.type === 'tilelayer' && layer.name !== 'collision' && layer.visible)
        map.createLayer(layer.name, tiles)?.setDepth(0);
    const outlines = this.add.graphics().setDepth(1);
    for (const zone of parsed.zones) {
      outlines.lineStyle(1, zone.kind === 'meeting' ? 0xdde5cf : 0xe9d6a7, 0.4);
      outlines.strokeRoundedRect(zone.x + 2, zone.y + 2, zone.width - 4, zone.height - 4, 5);
      const label = this.add
        .text(zone.x + zone.width / 2, zone.y + 9, zone.name, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#f4efdf',
          backgroundColor: '#657162',
          padding: { x: 5, y: 3 },
        })
        .setOrigin(0.5, 0)
        .setDepth(2);
      this.zoneLabels.set(zone.id, label);
    }
    for (let character = 0; character < 8; character++)
      for (const [d, direction] of directions.entries()) {
        this.anims.create({
          key: `${character}-${direction}`,
          frames: this.anims.generateFrameNumbers('avatars', {
            start: character * 12 + d * 3,
            end: character * 12 + d * 3 + 2,
          }),
          frameRate: 8,
          repeat: -1,
        });
      }
    this.cameras.main
      .setBounds(0, 0, parsed.width, parsed.height)
      .setZoom(1.6)
      .setRoundPixels(true);
    this.cameras.main.setBackgroundColor('#3f4a40');
    this.unsubscribe = this.bridge.subscribe((snapshot) => this.receive(snapshot));
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clearKeys);
    document.addEventListener('visibilitychange', this.clearKeys);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.clearKeys();
      window.removeEventListener('keydown', this.keyDown);
      window.removeEventListener('keyup', this.keyUp);
      window.removeEventListener('blur', this.clearKeys);
      document.removeEventListener('visibilitychange', this.clearKeys);
      this.avatars.clear();
      this.zoneLabels.clear();
    });
  }
  private keyDirection(key: string): Direction | undefined {
    return (
      {
        w: 'up',
        a: 'left',
        s: 'down',
        d: 'right',
        arrowup: 'up',
        arrowleft: 'left',
        arrowdown: 'down',
        arrowright: 'right',
      } as Record<string, Direction>
    )[key.toLowerCase()];
  }
  private keyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (
      target.closest('input,textarea,select,[contenteditable],dialog') ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      this.clearKeys();
      return;
    }
    const direction = this.keyDirection(event.key);
    if (!direction) return;
    event.preventDefault();
    if (!this.keys.has(event.key.toLowerCase())) {
      this.keys.set(event.key.toLowerCase(), direction);
      this.sendHeading();
    }
  };
  private keyUp = (event: KeyboardEvent) => {
    if (this.keys.delete(event.key.toLowerCase())) this.sendHeading();
  };
  private clearKeys = () => {
    this.keys.clear();
    this.bridge.setHeading(null);
  };
  // The newest key held on each axis wins, so the two axes combine into a
  // diagonal and reversing one axis does not cancel the other.
  private sendHeading() {
    const held = [...this.keys.values()];
    const newest = (axis: Direction[]) => held.filter((d) => axis.includes(d)).at(-1) ?? null;
    this.bridge.setHeading(heading(newest(['left', 'right']), newest(['up', 'down'])));
  }
  private receive(snapshot: RenderSnapshot) {
    if (snapshot.workspace.mapRevision !== this.lastRevision) {
      location.reload();
      return;
    }
    if (snapshot.tick < this.lastTick) {
      // Reconnecting to a restarted process begins a new simulation clock.
      this.renderTime = snapshot.tick * STEP_MS - 100;
      for (const avatar of this.avatars.values()) avatar.samples = [];
    }
    this.snapshot = snapshot;
    const ids = new Set(snapshot.players.map((p) => p.id));
    for (const [id, avatar] of this.avatars)
      if (!ids.has(id)) {
        avatar.sprite.destroy();
        avatar.label.destroy();
        avatar.shadow.destroy();
        avatar.indicator.destroy();
        this.avatars.delete(id);
      }
    for (const authoritative of snapshot.players) {
      const player = authoritative.id === snapshot.selfId ? snapshot.predictedSelf : authoritative;
      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        avatar = {
          sprite: this.add.sprite(player.x, player.y + 4, 'avatars').setOrigin(0.5, 1),
          label: this.add
            .text(player.x, player.y - 34, player.displayName, {
              fontFamily: 'system-ui',
              fontSize: '9px',
              color: '#fff8e9',
              backgroundColor: '#3c4940dd',
              padding: { x: 5, y: 2 },
            })
            .setOrigin(0.5, 1),
          shadow: this.add.ellipse(player.x, player.y, 18, 7, 0x293c34, 0.25),
          indicator: this.add.circle(player.x, player.y - 38, 3, statusColors[player.status]),
          samples: [],
          target: player,
        };
        this.avatars.set(player.id, avatar);
        if (player.id === snapshot.selfId)
          this.cameras.main.startFollow(avatar.sprite, true, 0.15, 0.15);
      }
      avatar.target = player;
      if (snapshot.tick !== this.lastTick) {
        avatar.samples.push({ time: snapshot.tick * STEP_MS, player });
        if (avatar.samples.length > 12) avatar.samples.shift();
      }
      avatar.label.setText(player.displayName + (player.id === snapshot.selfId ? ' · you' : ''));
      avatar.indicator.setFillStyle(statusColors[player.status]);
    }
    this.lastTick = snapshot.tick;
    for (const zone of this.zones) {
      const owner = snapshot.members.find((m) => m.id === snapshot.workspace.desks[zone.id]);
      this.zoneLabels.get(zone.id)?.setText(owner ? `${owner.displayName}'s desk` : zone.name);
    }
  }
  update(_time: number, delta: number) {
    // Packet jitter may pause interpolation, but must never rewind it.
    const renderTime = (this.renderTime = Math.max(
      this.renderTime,
      this.snapshot.tick * STEP_MS +
        Math.min(performance.now() - this.snapshot.receivedAt, 150) -
        100,
    ));
    for (const [id, avatar] of this.avatars) {
      let { x, y } = avatar.target;
      if (id !== this.snapshot.selfId && avatar.samples.length) {
        const samples = avatar.samples;
        while (samples.length > 2 && samples[1].time <= renderTime) samples.shift();
        const a = samples[0],
          b = samples[1] ?? a;
        const t = a === b ? 1 : Phaser.Math.Clamp((renderTime - a.time) / (b.time - a.time), 0, 1);
        x = Phaser.Math.Linear(a.player.x, b.player.x, t);
        y = Phaser.Math.Linear(a.player.y, b.player.y, t);
      } else {
        const t = 1 - Math.exp(-delta / 28);
        x = Phaser.Math.Linear(avatar.sprite.x, x, t);
        y = Phaser.Math.Linear(avatar.sprite.y - 4, y, t);
        if (Phaser.Math.Distance.Between(x, y, avatar.target.x, avatar.target.y) > 160) {
          x = avatar.target.x;
          y = avatar.target.y;
        }
      }
      avatar.sprite.setPosition(x, y + 4).setDepth(10 + y);
      avatar.shadow.setPosition(x, y).setDepth(9 + y);
      avatar.label.setPosition(x, y - 30).setDepth(10000);
      avatar.indicator.setPosition(x - avatar.label.width / 2 - 4, y - 38).setDepth(10001);
      if (avatar.target.moving)
        avatar.sprite.play(`${avatar.target.character}-${avatar.target.direction}`, true);
      else {
        avatar.sprite.stop();
        avatar.sprite.setFrame(
          avatar.target.character * 12 + directions.indexOf(avatar.target.direction) * 3 + 1,
        );
      }
    }
  }
}
