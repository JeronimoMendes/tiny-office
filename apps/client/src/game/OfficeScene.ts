import Phaser from 'phaser';
import {
  heading,
  appearanceFrames,
  appearanceLayers,
  presetAppearance,
  parseMap,
  STEP_MS,
  type Direction,
  type Player,
  type TiledMap,
} from '@office/shared';
import type { RendererBridge, RenderSnapshot } from '../session/bridge';

// Bundled artwork uses 4x sheets with hard 4px blocks: each block is one world
// pixel. Custom tilesets can provide a matching @4x sibling or a native PNG.
const ART = 4;
// Labels are built oversized and scaled down so they stay sharp under camera zoom.
const LABEL = 3;
const DEPTH = { props: 5, zones: 6, labels: 7 };

type PropManifest = {
  scale: number;
  anchor: [number, number];
  items: { name: string; label: string; frame: number }[];
};

// Phaser is handed the map described at the artwork's own resolution and the
// layers are scaled back down, so the simulation keeps its 32px cells while the
// tiles keep every pixel they were drawn with.
function artResolution(map: TiledMap, scale: number) {
  const [tileset] = map.tilesets;
  const width = tileset.tilewidth * scale;
  const height = tileset.tileheight * scale;
  return {
    ...map,
    tilewidth: map.tilewidth * scale,
    tileheight: map.tileheight * scale,
    tilesets: [
      {
        ...tileset,
        tilewidth: width,
        tileheight: height,
        // Phaser counts the tiles it can cut from these, so they have to grow too.
        imagewidth: tileset.columns * width,
        imageheight: Math.ceil(tileset.tilecount / tileset.columns) * height,
      },
    ],
  };
}

type Sample = { time: number; player: Player };
type Avatar = {
  sprite: Phaser.GameObjects.Container;
  layers: Phaser.GameObjects.Sprite[];
  rows: number[];
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
    const declared = this.snapshot.workspace.map.tilesets[0];
    // The first expanded starter map reused office.png before its 40-tile sheet
    // was renamed. Persisted revisions still carry that filename; select by its
    // layout too, so GID 2 remains alternate wood instead of becoming a wall.
    const image =
      declared.image === '../assets/office.png' &&
      declared.columns === 8 &&
      declared.tilecount === 40
        ? 'office-cozy.png'
        : declared.image.split('/').pop();
    const tileset = `/assets/${image}`;
    this.load.image('office-tiles', tileset.replace(/\.png$/, `@${ART}x.png`));
    // A replacement tileset need not ship a supersampled sibling.
    let fallback = false;
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.key !== 'office-tiles' || fallback) return;
      fallback = true;
      this.load.image('office-tiles', tileset);
    });
    for (const { name } of appearanceLayers)
      this.load.spritesheet(`wardrobe-${name}`, `/assets/wardrobe/${name}.png`, {
        frameWidth: 24,
        frameHeight: 32,
      });
    this.load.spritesheet('props', '/assets/props.png', { frameWidth: 128, frameHeight: 128 });
    this.load.json('props-manifest', '/assets/props.json');
  }
  create() {
    const parsed = parseMap(this.snapshot.workspace.map);
    const [declared] = parsed.tiled.tilesets;
    // Measure the sheet that actually loaded rather than trusting a constant, so
    // a hand-drawn replacement at any resolution still lands on the same grid.
    const source = this.textures.get('office-tiles').getSourceImage();
    const scale = Math.max(source.width / (declared.columns * declared.tilewidth), 1);
    this.cache.tilemap.add('office-map', {
      format: Phaser.Tilemaps.Formats.TILED_JSON,
      data: artResolution(this.snapshot.workspace.map, scale),
    });
    const map = this.make.tilemap({ key: 'office-map' });
    const tiles = map.addTilesetImage(declared.name, 'office-tiles')!;
    let depth = 0;
    for (const layer of parsed.tiled.layers)
      if (layer.type === 'tilelayer' && layer.name !== 'collision' && layer.visible)
        map
          .createLayer(layer.name, tiles)
          ?.setScale(1 / scale)
          .setDepth(depth++);
    this.decorate(parsed.tiled);
    const outlines = this.add.graphics().setDepth(DEPTH.zones);
    for (const zone of parsed.zones) {
      outlines.lineStyle(1.5, zone.kind === 'meeting' ? 0xe4ecdb : 0xf0dcac, 0.32);
      outlines.strokeRoundedRect(zone.x + 3, zone.y + 3, zone.width - 6, zone.height - 6, 8);
      const label = this.add
        .text(zone.x + zone.width / 2, zone.y + 8, zone.name, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: `${9 * LABEL}px`,
          color: '#f4efdf',
          backgroundColor: '#4d584bcc',
          padding: { x: 6 * LABEL, y: 3 * LABEL },
        })
        .setOrigin(0.5, 0)
        .setScale(1 / LABEL)
        .setDepth(DEPTH.labels);
      this.zoneLabels.set(zone.id, label);
    }
    this.cameras.main.setBounds(0, 0, parsed.width, parsed.height).setZoom(2);
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
  // Desk props live in the map as points, so a workspace can be dressed — and
  // later personalised — without redrawing a tile.
  private decorate(tiled: TiledMap) {
    const manifest = this.cache.json.get('props-manifest') as PropManifest | undefined;
    if (!manifest) return;
    const frames = new Map(manifest.items.map((item) => [item.name, item.frame]));
    const layer = tiled.layers.find((l) => l.name === 'props' && l.type === 'objectgroup');
    // Persisted starter maps used eight GIDs and had no prop layer. Dress their
    // clean desk tiles with separate sprites, preserving every saved position.
    if (
      !layer &&
      tiled.tilesets[0].image === '../assets/office.png' &&
      tiled.tilesets[0].tilecount === 8
    ) {
      for (const tiles of tiled.layers) {
        if (tiles.type !== 'tilelayer' || !tiles.visible || tiles.name === 'collision') continue;
        tiles.data?.forEach((gid, cell) => {
          if (gid !== 3) return;
          const x = (cell % tiled.width) * 32 + 16;
          const y = Math.floor(cell / tiled.width) * 32 + 15;
          this.add
            .image(x, y, 'props', frames.get('monitor'))
            .setOrigin(manifest.anchor[0], manifest.anchor[1])
            .setScale(0.65 / manifest.scale)
            .setDepth(DEPTH.props + y / 10000);
        });
      }
    }
    if (!layer?.visible) return;
    for (const object of layer.objects ?? []) {
      if (object.visible === false) continue;
      const frame = frames.get(String(object.properties.find((p) => p.name === 'prop')?.value));
      if (frame === undefined) continue;
      this.add
        .image(object.x, object.y, 'props', frame)
        .setOrigin(manifest.anchor[0], manifest.anchor[1])
        .setScale(1 / manifest.scale)
        .setDepth(DEPTH.props + object.y / 10000)
        .setAlpha(layer.opacity);
    }
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
        const layers = appearanceLayers.map(({ name }) =>
          this.add.sprite(0, 0, `wardrobe-${name}`).setOrigin(0.5, 1),
        );
        avatar = {
          sprite: this.add.container(player.x, player.y + 4, layers),
          layers,
          rows: [],
          label: this.add
            .text(player.x, player.y - 34, player.displayName, {
              fontFamily: 'system-ui, sans-serif',
              fontSize: `${9 * LABEL}px`,
              color: '#fff8e9',
              backgroundColor: '#3c4940dd',
              padding: { x: 5 * LABEL, y: 2 * LABEL },
            })
            .setOrigin(0.5, 1)
            .setScale(1 / LABEL),
          shadow: this.add.ellipse(player.x, player.y, 20, 8, 0x293c34, 0.22),
          indicator: this.add.circle(player.x, player.y - 38, 3, statusColors[player.status]),
          samples: [],
          target: player,
        };
        this.avatars.set(player.id, avatar);
        if (player.id === snapshot.selfId)
          this.cameras.main.startFollow(avatar.sprite, true, 0.15, 0.15);
      }
      avatar.rows = appearanceFrames(player.appearance ?? presetAppearance(player.character)).map(
        ({ row }) => row,
      );
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
      avatar.indicator.setPosition(x - avatar.label.displayWidth / 2 - 4, y - 38).setDepth(10001);
      const gait = avatar.target.moving ? Math.floor(_time / 125) % 3 : 1;
      const frame = directions.indexOf(avatar.target.direction) * 3 + gait;
      avatar.layers.forEach((layer, index) => layer.setFrame(avatar.rows[index] * 12 + frame));
    }
  }
}
