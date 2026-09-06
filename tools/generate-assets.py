"""Original pixel artwork and optional starter map. Python standard library only.
Run from any directory; use --map to also replace maps/office.tmj.
All generated artwork is dedicated to the public domain under CC0-1.0.

Geometry is authored at 4x but snapped to world pixels. Native 32px tilesets
serve Tiled; matching @4x sheets preserve identical pixels in the renderer.
"""

import argparse
import json
import runpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import art_avatars
import art_items
import art_tiles
from draw import Image, write_png

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--map', action='store_true', help='Also replace the starter map on disk')
args = parser.parse_args()
SCALE = 4
W, H = 40, 28


def downsample(src, factor):
    out = Image(src.w // factor, src.h // factor)
    area = factor * factor
    for y in range(out.h):
        for x in range(out.w):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(y * factor, y * factor + factor):
                for sx in range(x * factor, x * factor + factor):
                    i = (sy * src.w + sx) * 4
                    a = src.px[i + 3]
                    acc[0] += src.px[i] * a
                    acc[1] += src.px[i + 1] * a
                    acc[2] += src.px[i + 2] * a
                    acc[3] += a
            j = (y * out.w + x) * 4
            if acc[3] > 0:
                out.px[j] = acc[0] / acc[3]
                out.px[j + 1] = acc[1] / acc[3]
                out.px[j + 2] = acc[2] / acc[3]
            out.px[j + 3] = acc[3] / area
    return out


tileset, GID, slots = art_tiles.build()
write_png(ROOT / 'assets/office-cozy@4x.png', tileset)
write_png(ROOT / 'assets/office-cozy.png', downsample(tileset, SCALE))
# Keep the original eight GIDs available for already-persisted office maps.
# Their clean furniture uses the same palette as the expanded starter tileset.
def fit_cell(src):
    out = Image(128, 128)
    for y in range(0, 128, 4):
        for x in range(0, 128, 4):
            sx = int(x * src.w / 128) // 4 * 4
            i = (y * src.w + sx) * 4
            for yy in range(y, y + 4):
                for xx in range(x, x + 4):
                    j = (yy * 128 + xx) * 4
                    out.px[j:j + 4] = src.px[i:i + 4]
    return out

legacy = Image(8 * 128, 128)
for i, render in enumerate((art_tiles.floor_wood, art_tiles.wall, art_tiles.desk,
                            art_tiles.plant_tall, lambda: art_tiles.rug_cell(1, 1),
                            art_tiles.floor_stone, art_tiles.bookshelf, art_tiles.couch)):
    legacy.paste(fit_cell(render()), i * 128, 0)
write_png(ROOT / 'assets/office@4x.png', legacy)
write_png(ROOT / 'assets/office.png', downsample(legacy, SCALE))

TILESET_ROWS = tileset.h // art_tiles.TILE

items_atlas, ITEM_MANIFEST = art_items.build()
write_png(ROOT / 'assets/props.png', items_atlas)

avatar_sheet, wardrobe, avatar_layers = art_avatars.build()
write_png(ROOT / 'assets/avatars.png', avatar_sheet)
for name, sheet in avatar_layers.items():
    write_png(ROOT / f'assets/avatar-layers/{name}.png', sheet)

WIDTHS = {name: width for name, width, _ in art_tiles.PIECES}

floor = [GID['floor.wood']] * (W * H)
rugs = [0] * (W * H)
furniture = [0] * (W * H)
collision = [0] * (W * H)
props = []


def paint(x, y, name):
    floor[y * W + x] = GID[name]


def put(x, y, name, solid=True):
    for i in range(WIDTHS[name]):
        key = name if WIDTHS[name] == 1 else f'{name}.{i}'
        furniture[y * W + x + i] = GID[key]
        collision[y * W + x + i] = 2 if solid else 0


def area(x0, y0, x1, y1, name):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            paint(x, y, name)


def rug(x0, y0, w, h):
    for j in range(h):
        row = 'tl' if j == 0 else 'bl' if j == h - 1 else 'l'
        for i in range(w):
            edge = 't' if j == 0 else 'b' if j == h - 1 else 'c'
            name = row if i == 0 else row.replace('l', 'r') if i == w - 1 else edge
            rugs[(y0 + j) * W + x0 + i] = GID[f'rug.{name}']


def prop(name, x, y, surface=None):
    props.append({'name': name, 'x': x, 'y': y, 'surface': surface})


for x in range(W):
    for y in range(H):
        if (x + y) % 2:
            paint(x, y, 'floor.wood.alt')

for x in range(W):
    put(x, 0, 'wall')
    put(x, H - 1, 'wall')
for y in range(H):
    put(0, y, 'wall')
    put(W - 1, y, 'wall')
for x in (6, 7, 18, 19, 21, 22, 33, 34):
    put(x, 0, 'wall.window')
for x in (10, 30):
    put(x, 0, 'wall.art')
for x in (8, 9, 30, 31):
    put(x, H - 1, 'wall.window')
for y in (8, 9, 18, 19):
    put(0, y, 'wall.window')
    put(W - 1, y, 'wall.window')

# Meeting rooms flank an open lounge along the north wall.
ROOMS = [('cedar', 'Cedar room', 2, 14), ('fern', 'Fern room', 25, 37)]
for _, _, left, right in ROOMS:
    area(left + 1, 3, right - 1, 9, 'floor.stone')
    for x in range(left, right + 1):
        put(x, 2, 'wall')
        if x not in (left + 5, left + 6, left + 7):
            put(x, 10, 'wall')
    for y in range(3, 10):
        put(left, y, 'wall')
        put(right, y, 'wall')
    put(left + 6, 2, 'wall.board')
    put(left + 2, 2, 'wall.art')
    put(right - 2, 2, 'wall.window')
    put(left + 5, 6, 'table')
    for x in (left + 5, left + 6):
        put(x, 5, 'chair.up', solid=False)
        put(x, 7, 'chair.down', solid=False)
    put(left + 1, 3, 'plant.tall')
    put(right - 1, 9, 'plant.small')
    put(left + 1, 8, 'cabinet')
    prop('mug', (left + 5) * 32 + 20, 6 * 32 + 16)
    prop('notepad', (left + 6) * 32 + 14, 6 * 32 + 20)
    prop('succulent', (left + 1) * 32 + 16, 8 * 32 + 8)

rug(16, 4, 8, 5)
put(18, 2, 'couch')
put(20, 2, 'couch')
put(16, 1, 'bookshelf')
put(23, 1, 'bookshelf')
put(15, 2, 'lamp')
put(24, 2, 'plant.tall')
put(17, 8, 'stool', solid=False)
put(22, 8, 'stool', solid=False)
put(15, 9, 'divider')
put(24, 9, 'divider')
prop('books', 16 * 32 + 16, 1 * 32 + 26)
prop('terrarium', 23 * 32 + 16, 1 * 32 + 26)

# Two rows of desk pods fill the floor south of the rooms.
PODS = [(4, 14), (11, 14), (25, 14), (32, 14), (4, 20), (11, 20), (25, 20), (32, 20)]
KITS = [
    (('monitor', 30, 15), ('keyboard', 32, 22), ('mug', 12, 21)),
    (('laptop', 26, 18), ('succulent', 52, 21), ('notepad', 12, 22)),
    (('monitor', 34, 15), ('pencils', 12, 20), ('photo', 56, 19)),
    (('laptop', 28, 18), ('cat', 54, 21), ('mug', 10, 21)),
    (('monitor', 30, 15), ('cactus', 10, 19), ('stickies', 54, 22)),
    (('laptop', 26, 18), ('headphones', 54, 20), ('books', 10, 22)),
    (('monitor', 32, 15), ('duck', 12, 22), ('terrarium', 54, 20)),
    (('laptop', 28, 18), ('trophy', 54, 20), ('speaker', 10, 21)),
]
for n, (x, y) in enumerate(PODS):
    put(x, y, 'desk')
    put(x, y + 1, 'chair.down', solid=False)
    put(x + 3, y, 'plant.small' if n % 2 else 'cabinet')
    for name, dx, dy in KITS[n]:
        prop(name, x * 32 + dx, y * 32 + dy, f'desk-{n + 1}')
    if n % 2 == 0:
        prop('lamp', x * 32 + 58, y * 32 + 16, f'desk-{n + 1}')

for x, y in ((1, 12), (38, 12), (1, 25), (38, 25)):
    put(x, y, 'plant.tall')
for x, y in ((14, 12), (25, 12)):
    put(x, y, 'lamp')
for x in (16, 17, 22, 23):
    put(x, 12, 'divider')
    put(x, 18, 'divider')

# Coffee corner against the south wall.
area(16, 23, 23, 26, 'floor.kitchen')
put(18, 25, 'counter')
put(20, 25, 'counter')
put(17, 25, 'cooler')
put(22, 25, 'cabinet')
put(17, 23, 'stool', solid=False)
put(22, 23, 'stool', solid=False)
prop('mug', 18 * 32 + 44, 25 * 32 + 14)
prop('mug', 19 * 32 + 30, 25 * 32 + 12)
prop('succulent', 22 * 32 + 16, 25 * 32 + 8)

zones = []


def zone(zid, name, kind, x, y, w, h):
    zones.append(
        {
            'id': len(zones) + 1,
            'name': name,
            'type': '',
            'x': x * 32,
            'y': y * 32,
            'width': w * 32,
            'height': h * 32,
            'rotation': 0,
            'visible': True,
            'properties': [
                {'name': 'zoneId', 'type': 'string', 'value': zid},
                {'name': 'kind', 'type': 'string', 'value': kind},
            ],
        }
    )


for zid, name, left, _ in ROOMS:
    zone(zid, name, 'meeting', left + 1, 3, 11, 8)
for n, (x, y) in enumerate(PODS):
    zone(f'desk-{n + 1}', f'Desk {n + 1}', 'desk', x - 1, y - 1, 5, 4)

layers = []
for n, (name, data) in enumerate(
    [('floor', floor), ('rug', rugs), ('furniture', furniture), ('collision', collision)]
):
    layers.append(
        {
            'id': n + 1,
            'name': name,
            'type': 'tilelayer',
            'width': W,
            'height': H,
            'x': 0,
            'y': 0,
            'opacity': 1,
            'visible': name != 'collision',
            'data': data,
        }
    )
layers.append(
    {
        'id': 5,
        'name': 'zones',
        'type': 'objectgroup',
        'draworder': 'topdown',
        'opacity': 1,
        'visible': True,
        'objects': zones,
    }
)
layers.append(
    {
        'id': 6,
        'name': 'props',
        'type': 'objectgroup',
        'draworder': 'topdown',
        'opacity': 1,
        'visible': True,
        'objects': [
            {
                'id': 200 + i,
                'name': p['name'],
                'point': True,
                'x': p['x'],
                'y': p['y'],
                'width': 0,
                'height': 0,
                'rotation': 0,
                'visible': True,
                'properties': [{'name': 'prop', 'type': 'string', 'value': p['name']}]
                + ([{'name': 'surface', 'type': 'string', 'value': p['surface']}] if p['surface'] else []),
            }
            for i, p in enumerate(props)
        ],
    }
)
layers.append(
    {
        'id': 7,
        'name': 'spawn',
        'type': 'objectgroup',
        'draworder': 'topdown',
        'opacity': 1,
        'visible': True,
        'objects': [
            {
                'id': 99,
                'name': 'spawn',
                'point': True,
                'x': 20 * 32 + 16,
                'y': 20 * 32 + 16,
                'width': 0,
                'height': 0,
                'rotation': 0,
                'visible': True,
            }
        ],
    }
)

# Surface rectangles use world-pixel coordinates, independent of call zones.
# A future editor can store item offsets relative to this stable desk ID.
layers.append({
    'id': 8, 'name': 'surfaces', 'type': 'objectgroup', 'draworder': 'topdown',
    'opacity': 1, 'visible': False,
    'objects': [
        {'id': 300 + i, 'name': f'desk-{i + 1}',
         'x': x * 32 + 3, 'y': y * 32 + 9, 'width': 58, 'height': 13,
         'rotation': 0, 'visible': True,
         'properties': [{'name': 'surfaceId', 'type': 'string', 'value': f'desk-{i + 1}'}]}
        for i, (x, y) in enumerate(PODS)
    ],
})

map_data = {
    'compressionlevel': -1,
    'width': W,
    'height': H,
    'infinite': False,
    'orientation': 'orthogonal',
    'renderorder': 'right-down',
    'tilewidth': 32,
    'tileheight': 32,
    'type': 'map',
    'version': '1.10',
    'tiledversion': '1.11.2',
    'nextlayerid': 9,
    'nextobjectid': 400,
    'tilesets': [
        {
            'firstgid': 1,
            'name': 'office',
            'image': '../assets/office-cozy.png',
            'imagewidth': art_tiles.COLUMNS * 32,
            'imageheight': TILESET_ROWS * 32,
            'tilewidth': 32,
            'tileheight': 32,
            'tilecount': art_tiles.COLUMNS * TILESET_ROWS,
            'columns': art_tiles.COLUMNS,
            'margin': 0,
            'spacing': 0,
        }
    ],
    'layers': layers,
}
(ROOT / 'maps').mkdir(exist_ok=True)
if args.map:
    (ROOT / 'maps/office.tmj').write_text(json.dumps(map_data, indent=2) + '\n')

(ROOT / 'assets/props.json').write_text(json.dumps(ITEM_MANIFEST, indent=2) + '\n')
(ROOT / 'assets/avatars.json').write_text(
    json.dumps(
        {
            'frameWidth': art_avatars.W,
            'frameHeight': art_avatars.H,
            'scale': SCALE,
            'anchor': [0.5, 1],
            'layerOrder': list(art_avatars.LAYERS),
            'layers': {name: f'avatar-layers/{name}.png' for name in art_avatars.LAYERS},
            'directions': list(art_avatars.DIRECTIONS),
            'frames': art_avatars.FRAMES,
            'characters': wardrobe,
        },
        indent=2,
    )
    + '\n'
)
print(f'tiles {tileset.w}x{tileset.h} ({slots} slots)  props {len(props)}  avatars {avatar_sheet.w}x{avatar_sheet.h}')

runpy.run_path(str(ROOT / 'tools/generate-wardrobe.py'))
