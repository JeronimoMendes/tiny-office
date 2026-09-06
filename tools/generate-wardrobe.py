"""Generate independent wardrobe atlases. Standard library only; does not change maps.

Options are append-only stable indices shared with the server and client.
Atlases use native 24x32 frames to keep texture sizes small on mobile GPUs.
"""
import json
from itertools import product
from pathlib import Path
import art_avatars as art
from draw import Image, write_png

ROOT = Path(__file__).resolve().parent.parent
options = json.loads((ROOT / 'packages/shared/src/wardrobe.json').read_text())
LAYERS = {
    'hair_back': ['hair', 'hairColor'], 'body': ['skin'],
    'pants': ['pants', 'pantsColor'], 'shoes': ['shoes', 'shoesColor'],
    'shirt': ['shirt', 'shirtColor'], 'hands': ['shirt', 'skin'],
    'head': ['head', 'skin'], 'hair': ['hair', 'hairColor'],
    'accessory': ['accessory'], 'hat': ['hat'],
}
KEYS = dict(head='head_style', skin='skin', hair='hair_style', hairColor='hair',
            shirt='top_style', shirtColor='top', pants='bottom_style', pantsColor='bottom',
            shoes='shoe_style', shoesColor='shoes', accessory='accessory', hat='hat')

for name, slots in LAYERS.items():
    combinations = list(product(*(options[slot] for slot in slots)))
    sheet = Image(24 * 12, 32 * len(combinations))
    for row, values in enumerate(combinations):
        spec = dict(art.WARDROBE[0], accessory='none', hat='none', accent='dfb066')
        for slot, value in zip(slots, values):
            spec[KEYS[slot]] = value.lstrip('#').lower()
        for d, direction in enumerate(art.DIRECTIONS):
            for frame in range(3):
                layer = art.frame_layers(spec, direction, frame)[name]
                # Every 4x4 source block is a single solid pixel.
                for y in range(32):
                    for x in range(24):
                        src = ((y * 4) * art.W + x * 4) * 4
                        dst = ((row * 32 + y) * sheet.w + (d * 3 + frame) * 24 + x) * 4
                        sheet.px[dst:dst + 4] = layer.px[src:src + 4]
    write_png(ROOT / f'assets/wardrobe/{name}.png', sheet)
    print(f'{name}: {len(combinations)} styles', flush=True)
