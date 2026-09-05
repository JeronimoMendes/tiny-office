"""Original placeholder art and starter map. Python standard library only.
Run from the project root. WARNING: regenerates maps/office.tmj.
All generated artwork is dedicated to the public domain under CC0-1.0.
"""
import json
import struct
import zlib
from pathlib import Path


def canvas(w, h):
    return [[(0, 0, 0, 0) for _ in range(w)] for _ in range(h)]


def rect(img, x, y, w, h, color):
    c = tuple(bytes.fromhex(color)) + (255,)
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if 0 <= yy < len(img) and 0 <= xx < len(img[0]):
                img[yy][xx] = c


def png(path, img):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    raw = b''.join(b'\0' + bytes(c for pixel in row for c in pixel) for row in img)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', len(img[0]), len(img), 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


tiles = canvas(256, 32)
for tile in range(8):
    x = tile * 32
    if tile == 0:  # warm oak floor
        rect(tiles, x, 0, 32, 32, 'b9ad90')
        rect(tiles, x, 0, 32, 1, 'a89d83')
        rect(tiles, x, 16, 32, 1, 'afa387')
        rect(tiles, x + 11, 1, 1, 15, 'afa387')
        rect(tiles, x + 25, 17, 1, 15, 'afa387')
        rect(tiles, x + 3, 8, 7, 1, 'c2b698')
    elif tile == 1:  # wall
        rect(tiles, x, 0, 32, 32, '666f60')
        rect(tiles, x, 0, 32, 5, '9ea48b')
        rect(tiles, x, 5, 32, 21, '7d856e')
        rect(tiles, x, 27, 32, 5, '505c50')
        rect(tiles, x + 30, 5, 2, 21, '757d67')
    elif tile == 2:  # desk + monitor
        rect(tiles, x + 3, 10, 26, 19, '74614d')
        rect(tiles, x + 2, 6, 28, 18, 'c79967')
        rect(tiles, x + 3, 6, 26, 2, 'dfb986')
        rect(tiles, x + 8, 5, 16, 12, '384d49')
        rect(tiles, x + 10, 7, 12, 7, '96b9b0')
        rect(tiles, x + 14, 17, 4, 3, '56635b')
        rect(tiles, x + 8, 21, 14, 2, 'e0d6b8')
    elif tile == 3:  # plant
        rect(tiles, x + 10, 22, 12, 8, 'a46d50')
        rect(tiles, x + 8, 20, 16, 4, 'c08763')
        rect(tiles, x + 14, 8, 4, 15, '506d49')
        rect(tiles, x + 5, 8, 12, 9, '5f845b')
        rect(tiles, x + 16, 3, 10, 12, '789664')
        rect(tiles, x + 9, 2, 8, 10, '8fa66e')
    elif tile == 4:  # carpet
        rect(tiles, x, 0, 32, 32, '859b91')
        for yy in range(2, 32, 4):
            for xx in range(2, 32, 4):
                rect(tiles, x + xx, yy, 1, 1, '93a89a')
    elif tile == 5:  # pale stone
        rect(tiles, x, 0, 32, 32, 'c9c6af')
        rect(tiles, x, 31, 32, 1, 'b9b7a1')
        rect(tiles, x + 31, 0, 1, 32, 'b9b7a1')
    elif tile == 6:  # bookshelf
        rect(tiles, x + 1, 2, 30, 29, '755e4d')
        for yy in (5, 17):
            for xx, color in [(4, 'ac7765'), (10, 'bfb083'), (16, '6f8b83'), (22, '9a9b7d')]:
                rect(tiles, x + xx, yy, 4, 9, color)
        rect(tiles, x + 1, 14, 30, 2, 'aa865c')
    else:  # couch
        rect(tiles, x + 2, 5, 28, 25, '526e67')
        rect(tiles, x + 4, 4, 24, 10, '72978a')
        rect(tiles, x + 5, 15, 22, 11, '87a296')
        rect(tiles, x + 15, 15, 1, 11, '72978a')
        rect(tiles, x + 1, 12, 4, 15, '65897c')
        rect(tiles, x + 27, 12, 4, 15, '65897c')
png('assets/office.png', tiles)

sprites = canvas(24 * 12, 32 * 8)
colors = ['739c91', 'ce9372', '919ec1', 'c4af6e', 'b58da1', '8fba79', 'c27667', '8ba8b2']
for character, color in enumerate(colors):
    for direction in range(4):  # down, left, right, up
        for frame in range(3):
            x, y = (direction * 3 + frame) * 24, character * 32
            bob = 1 if frame == 1 else 0
            stride = [-1, 0, 1][frame]
            rect(sprites, x + 7, y + 25, 4, 5 + stride, '414d4b')
            rect(sprites, x + 13, y + 25, 4, 5 - stride, '414d4b')
            rect(sprites, x + 6, y + 16 + bob, 12, 10, color)
            rect(sprites, x + 4, y + 18 + bob, 3, 7, 'd7ad88')
            rect(sprites, x + 17, y + 18 + bob, 3, 7, 'd7ad88')
            rect(sprites, x + 6, y + 5 + bob, 12, 11, 'd7ad88')
            rect(sprites, x + 5, y + 3 + bob, 14, 5, '574e45')
            rect(sprites, x + 5, y + 7 + bob, 3, 5, '574e45')
            if direction == 3:
                rect(sprites, x + 6, y + 6 + bob, 12, 8, '574e45')
            else:
                eyes = [9, 14] if direction == 0 else [8] if direction == 1 else [15]
                for eye in eyes:
                    rect(sprites, x + eye, y + 10 + bob, 2, 2, '394640')
png('assets/avatars.png', sprites)

W, H = 40, 28
floor, furniture, collision = [1] * (W * H), [0] * (W * H), [0] * (W * H)


def put(x, y, gid, solid=True):
    furniture[y * W + x] = gid
    collision[y * W + x] = 2 if solid else 0


for x in range(W):
    put(x, 0, 2); put(x, H - 1, 2)
for y in range(H):
    put(0, y, 2); put(W - 1, y, 2)
for left, right in [(2, 14), (25, 37)]:
    for y in range(2, 11):
        for x in range(left, right + 1):
            floor[y * W + x] = 5
    for x in range(left, right + 1):
        put(x, 2, 2)
        if x not in [left + 5, left + 6, left + 7]: put(x, 10, 2)
    for y in range(3, 10):
        put(left, y, 2); put(right, y, 2)
    for x in range(left + 4, left + 9): put(x, 6, 3)
    put(left + 1, 3, 4); put(right - 1, 3, 4)
for x, y in [(4, 14), (11, 14), (25, 14), (32, 14), (4, 20), (11, 20), (25, 20), (32, 20)]:
    put(x, y, 3); put(x + 1, y, 3); put(x + 3, y, 4)
for x in [17, 18, 19, 20, 21, 22]:
    put(x, 3, 7)
for x in [17, 18, 21, 22]: put(x, 8, 8)
for x, y in [(1, 12), (38, 12), (1, 25), (38, 25), (17, 24), (22, 24)]: put(x, y, 4)
zones = []


def zone(id, name, kind, x, y, w, h):
    zones.append({'id': len(zones) + 1, 'name': name, 'type': '', 'x': x * 32, 'y': y * 32, 'width': w * 32, 'height': h * 32, 'rotation': 0, 'visible': True, 'properties': [{'name': 'zoneId', 'type': 'string', 'value': id}, {'name': 'kind', 'type': 'string', 'value': kind}]})


zone('cedar', 'Cedar room', 'meeting', 3, 3, 11, 8)
zone('fern', 'Fern room', 'meeting', 26, 3, 11, 8)
for n, (x, y) in enumerate([(3, 13), (10, 13), (24, 13), (31, 13), (3, 19), (10, 19), (24, 19), (31, 19)]):
    zone(f'desk-{n+1}', f'Desk {n+1}', 'desk', x, y, 5, 4)
map_data = {'compressionlevel': -1, 'width': W, 'height': H, 'infinite': False, 'orientation': 'orthogonal', 'renderorder': 'right-down', 'tilewidth': 32, 'tileheight': 32, 'type': 'map', 'version': '1.10', 'tiledversion': '1.11.2', 'nextlayerid': 6, 'nextobjectid': 100, 'tilesets': [{'firstgid': 1, 'name': 'office', 'image': '../assets/office.png', 'imagewidth': 256, 'imageheight': 32, 'tilewidth': 32, 'tileheight': 32, 'tilecount': 8, 'columns': 8, 'margin': 0, 'spacing': 0}], 'layers': []}
for n, (name, data) in enumerate([('floor', floor), ('furniture', furniture), ('collision', collision)]):
    map_data['layers'].append({'id': n+1, 'name': name, 'type': 'tilelayer', 'width': W, 'height': H, 'x': 0, 'y': 0, 'opacity': 1, 'visible': name != 'collision', 'data': data})
map_data['layers'].append({'id': 4, 'name': 'zones', 'type': 'objectgroup', 'draworder': 'topdown', 'opacity': 1, 'visible': True, 'objects': zones})
map_data['layers'].append({'id': 5, 'name': 'spawn', 'type': 'objectgroup', 'draworder': 'topdown', 'opacity': 1, 'visible': True, 'objects': [{'id': 99, 'name': 'spawn', 'point': True, 'x': 20 * 32 + 16, 'y': 20 * 32 + 16, 'width': 0, 'height': 0}]})
Path('maps').mkdir(exist_ok=True)
Path('maps/office.tmj').write_text(json.dumps(map_data, indent=2) + '\n')
