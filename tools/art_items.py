"""Desk props. Each item lives in its own cell and is anchored at the point where
it meets the desk, so a map (and later a person) can drop one anywhere."""

import math

from draw import (
    Capsule,
    Ellipse,
    Grow,
    Image,
    Poly,
    Rect,
    fill,
    grain,
    linear,
    outline,
    rgb,
    shadow,
    shift,
    stripes,
)

CELL = 128
COLUMNS = 6
ANCHOR = (0.5, 0.82)
BASE = (CELL * ANCHOR[0], CELL * ANCHOR[1])
LIGHT = (-1.8, -2.2, 0.42, 8)
SOFT = (-1.4, -1.8, 0.24, 12)

INK = rgb('333d36')
CREAM = rgb('f2eddd')
WOOD = rgb('b78a5d')
CLAY = rgb('c4826a')
MUSTARD = rgb('dfb066')
TEAL = rgb('6d9089')
SLATE = rgb('5c7484')
LEAF = rgb('5f8a55')
LEAF_LIT = rgb('86ac6a')
SCREEN = rgb('2c3a3d')


def rest(img, shape, dy=4, blur=6, alpha=0.34):
    shadow(img, shape, (46, 40, 34), 1.5, dy, blur, alpha, 1.0)


def monitor():
    img = Image(CELL, CELL)
    x, y = BASE
    foot = Ellipse(x, y - 2, 26, 7)
    rest(img, foot, 3, 5)
    fill(img, Capsule(x, y - 6, x, y - 26, 9), shift(INK, 0.35), light=SOFT)
    fill(img, foot, shift(INK, 0.28), light=SOFT)
    shell = Rect(x - 52, y - 84, 104, 62, 7)
    rest(img, shell, 5, 7)
    fill(img, shell, shift(INK, 0.22), light=LIGHT)
    panel = Rect(x - 46, y - 78, 92, 48, 3)
    fill(img, panel, linear(0, y - 78, 0, y - 30, [(0, shift(SCREEN, 0.28)), (1, SCREEN)]))
    fill(img, Rect(x - 40, y - 72, 34, 5, 2), shift(TEAL, 0.3), alpha=0.85)
    fill(img, Rect(x - 40, y - 62, 62, 4, 2), shift(CREAM, -0.25), alpha=0.5)
    fill(img, Rect(x - 40, y - 54, 48, 4, 2), shift(CREAM, -0.25), alpha=0.4)
    fill(img, Rect(x + 2, y - 48, 42, 16, 3), MUSTARD, alpha=0.55)
    fill(img, Poly([(x - 46, y - 30), (x - 6, y - 78), (x + 10, y - 78), (x - 30, y - 30)]), (255, 255, 255), alpha=0.07)
    return img


def laptop():
    img = Image(CELL, CELL)
    x, y = BASE
    deck = Poly([(x - 44, y), (x + 44, y), (x + 36, y - 16), (x - 36, y - 16)], r=4)
    rest(img, deck, 4, 6)
    lid = Poly([(x - 36, y - 18), (x + 36, y - 18), (x + 42, y - 68), (x - 42, y - 68)], r=5)
    fill(img, lid, shift(CREAM, -0.24), light=LIGHT)
    screen = Poly([(x - 31, y - 23), (x + 31, y - 23), (x + 36, y - 63), (x - 36, y - 63)], r=3)
    fill(img, screen, linear(0, y - 63, 0, y - 23, [(0, shift(SCREEN, 0.3)), (1, SCREEN)]))
    fill(img, Rect(x - 26, y - 57, 30, 4, 2), shift(LEAF_LIT, 0.1), alpha=0.8)
    fill(img, Rect(x - 26, y - 49, 46, 3, 2), shift(CREAM, -0.3), alpha=0.45)
    fill(img, Rect(x - 26, y - 42, 36, 3, 2), shift(CREAM, -0.3), alpha=0.35)
    fill(img, deck, shift(CREAM, -0.14), light=SOFT)
    fill(img, Rect(x - 26, y - 13, 52, 8, 2), shift(CREAM, -0.34), alpha=0.7)
    return img


def keyboard():
    img = Image(CELL, CELL)
    x, y = BASE
    body = Rect(x - 52, y - 22, 104, 26, 6)
    rest(img, body, 3, 5)
    fill(img, body, shift(CREAM, -0.1), light=LIGHT)
    for row in range(3):
        for col in range(11):
            fill(img, Rect(x - 46 + col * 8.4, y - 18 + row * 6.4, 6.6, 5, 1.5), shift(CREAM, -0.28), alpha=0.85)
    fill(img, Rect(x - 20, y + 0.5, 40, 3, 1.5), shift(CREAM, -0.28), alpha=0.85)
    return img


def mug():
    img = Image(CELL, CELL)
    x, y = BASE
    body = Poly([(x - 17, y - 34), (x + 17, y - 34), (x + 14, y), (x - 14, y)], r=6)
    rest(img, body, 3, 5)
    fill(img, body, linear(x - 17, 0, x + 17, 0, [(0, shift(CLAY, 0.16)), (1, shift(CLAY, -0.26))]), light=LIGHT)
    handle = Grow(Ellipse(x + 17, y - 20, 13, 12), 0) - Grow(Ellipse(x + 17, y - 20, 7, 6), 0)
    fill(img, handle & Rect(x + 14, y - 34, 20, 30), shift(CLAY, -0.08), light=LIGHT)
    fill(img, Ellipse(x, y - 33, 16, 5.5), shift(CLAY, -0.3))
    fill(img, Ellipse(x, y - 33, 12.5, 4), rgb('4c3428'))
    for i, dx in enumerate((-7, 2, 9)):
        fill(img, Capsule(x + dx, y - 44, x + dx + (4 if i % 2 else -4), y - 62, 4), CREAM, alpha=0.3)
    return img


def desk_lamp():
    img = Image(CELL, CELL)
    x, y = BASE
    base = Ellipse(x - 20, y - 3, 22, 8)
    rest(img, base, 3, 5)
    fill(img, base, shift(SLATE, -0.1), light=SOFT)
    fill(img, Capsule(x - 20, y - 6, x - 14, y - 52, 6), shift(SLATE, 0.05), light=SOFT)
    fill(img, Capsule(x - 14, y - 52, x + 14, y - 66, 6), shift(SLATE, 0.05), light=SOFT)
    hood = Poly([(x + 2, y - 74), (x + 30, y - 66), (x + 36, y - 44), (x + 10, y - 52)], r=6)
    fill(img, Grow(hood, 7), MUSTARD, alpha=0.16, softness=6)
    fill(img, hood, shift(MUSTARD, -0.1), light=LIGHT)
    fill(img, Ellipse(x + 23, y - 48, 11, 8), shift(CREAM, 0.05))
    return img


def succulent():
    img = Image(CELL, CELL)
    x, y = BASE
    pot = Poly([(x - 20, y - 26), (x + 20, y - 26), (x + 16, y), (x - 16, y)], r=5)
    rest(img, pot, 3, 5)
    for cx, cy, rx, ry in ((-14, -36, 12, 9), (13, -34, 12, 9), (0, -46, 11, 9), (-6, -30, 10, 8), (8, -44, 10, 8)):
        blade = Ellipse(x + cx, y + cy, rx, ry)
        fill(img, Grow(blade, 1.4), shift(LEAF, -0.35), alpha=0.55)
        fill(img, blade, LEAF_LIT if cy < -40 else LEAF, light=LIGHT)
    fill(img, pot, linear(x - 20, 0, x + 20, 0, [(0, shift(CREAM, 0.02)), (1, shift(CREAM, -0.3))]), light=LIGHT)
    fill(img, Rect(x - 22, y - 30, 44, 9, 4), shift(CREAM, -0.06), light=LIGHT)
    return img


def cactus():
    img = Image(CELL, CELL)
    x, y = BASE
    pot = Poly([(x - 18, y - 24), (x + 18, y - 24), (x + 15, y), (x - 15, y)], r=5)
    rest(img, pot, 3, 5)
    trunk = Capsule(x, y - 28, x, y - 70, 15)
    arms = Capsule(x - 16, y - 44, x - 16, y - 58, 8) | Capsule(x + 15, y - 38, x + 15, y - 52, 7)
    fill(img, Grow(trunk | arms, 1.5), shift(LEAF, -0.4), alpha=0.55)
    fill(img, trunk | arms, LEAF, light=(-2, -2.4, 0.36, 9))
    for i in range(9):
        fill(img, Ellipse(x - 9 + (i % 3) * 9, y - 34 - (i // 3) * 12, 1.6, 1.6), CREAM, alpha=0.6)
    fill(img, Ellipse(x + 2, y - 74, 7, 6), CLAY, light=SOFT)
    fill(img, pot, linear(x - 18, 0, x + 18, 0, [(0, shift(CLAY, 0.14)), (1, shift(CLAY, -0.26))]), light=LIGHT)
    fill(img, Rect(x - 20, y - 28, 40, 9, 4), shift(CLAY, 0.16), light=LIGHT)
    return img


def books():
    img = Image(CELL, CELL)
    x, y = BASE
    colors = (TEAL, CLAY, MUSTARD)
    rest(img, Rect(x - 38, y - 12, 76, 12, 3), 3, 5)
    for i, colr in enumerate(colors):
        w = 74 - i * 8
        book = Rect(x - w / 2 + i * 3, y - 13 - i * 12, w, 12, 3)
        fill(img, book, colr, light=LIGHT)
        fill(img, Rect(x - w / 2 + i * 3 + 3, y - 10 - i * 12, w - 6, 3.5, 1.5), shift(colr, 0.34), alpha=0.7)
        outline(img, book, shift(colr, -0.3), 1.4, alpha=0.5)
    fill(img, Rect(x - 26, y - 48, 8, 12, 2), shift(CREAM, -0.04), light=SOFT)
    return img


def photo():
    img = Image(CELL, CELL)
    x, y = BASE
    frame = Rect(x - 32, y - 46, 64, 48, 4)
    rest(img, frame, 4, 6)
    fill(img, Poly([(x + 6, y - 4), (x + 22, y - 4), (x + 12, y - 22)], r=2), shift(WOOD, -0.3), alpha=0.8)
    fill(img, frame, shift(WOOD, 0.02), light=LIGHT)
    inner = Rect(x - 26, y - 40, 52, 36, 2)
    fill(img, inner, linear(0, y - 40, 0, y - 4, [(0, rgb('cfe0e4')), (1, rgb('e8e2cf'))]))
    fill(img, Ellipse(x - 8, y - 22, 8, 9), rgb('d7ad88'), clip=inner)
    fill(img, Ellipse(x + 9, y - 20, 7, 8), rgb('b98a6a'), clip=inner)
    fill(img, Ellipse(x - 8, y - 6, 12, 10), TEAL, clip=inner)
    fill(img, Ellipse(x + 9, y - 5, 11, 9), CLAY, clip=inner)
    outline(img, inner, shift(WOOD, -0.4), 1.4, alpha=0.4)
    return img


def notepad():
    img = Image(CELL, CELL)
    x, y = BASE
    pad = Rect(x - 40, y - 30, 80, 32, 4)
    rest(img, pad, 3, 5)
    fill(img, pad, shift(CREAM, 0.03), light=SOFT)
    for i in range(4):
        fill(img, Rect(x - 32, y - 24 + i * 7, 52 - (i % 2) * 14, 2.4, 1), shift(SLATE, 0.25), alpha=0.5)
    fill(img, Rect(x - 40, y - 30, 8, 32, 4), shift(CLAY, -0.05), light=SOFT)
    fill(img, Capsule(x + 6, y + 2, x + 34, y - 26, 5), MUSTARD, light=SOFT)
    fill(img, Capsule(x + 32, y - 24, x + 36, y - 30, 4), shift(INK, 0.2))
    return img


def pencils():
    img = Image(CELL, CELL)
    x, y = BASE
    cup = Poly([(x - 18, y - 30), (x + 18, y - 30), (x + 15, y), (x - 15, y)], r=5)
    rest(img, cup, 3, 5)
    for i, (dx, dy, colr) in enumerate(((-9, -60, CLAY), (0, -66, MUSTARD), (9, -58, TEAL), (5, -52, SLATE))):
        tilt = (i - 1.5) * 3
        fill(img, Capsule(x + dx - tilt, y - 26, x + dx + tilt, y + dy + 8, 5), colr, light=SOFT)
        fill(img, Poly([(x + dx + tilt - 5, y + dy + 8), (x + dx + tilt + 5, y + dy + 8), (x + dx + tilt, y + dy)]), shift(WOOD, 0.2))
    fill(img, cup, linear(x - 18, 0, x + 18, 0, [(0, shift(SLATE, 0.16)), (1, shift(SLATE, -0.24))]), light=LIGHT)
    fill(img, Rect(x - 19, y - 33, 38, 8, 3), shift(SLATE, 0.2), light=LIGHT)
    return img


def headphones():
    img = Image(CELL, CELL)
    x, y = BASE
    stand = Ellipse(x, y - 3, 22, 8)
    rest(img, stand, 3, 5)
    fill(img, stand, shift(WOOD, -0.2), light=SOFT)
    fill(img, Capsule(x, y - 6, x, y - 40, 7), shift(WOOD, 0.02), light=SOFT)
    band = Grow(Ellipse(x, y - 46, 30, 30), 0) - Grow(Ellipse(x, y - 46, 22, 22), 0)
    fill(img, band & Rect(x - 32, y - 80, 64, 34), shift(INK, 0.25), light=SOFT)
    for dx in (-27, 27):
        cup = Ellipse(x + dx, y - 44, 12, 16)
        fill(img, cup, shift(INK, 0.18), light=LIGHT)
        fill(img, Ellipse(x + dx, y - 44, 7, 11), shift(CLAY, -0.1), light=SOFT)
    return img


def cat():
    img = Image(CELL, CELL)
    x, y = BASE
    body = Ellipse(x, y - 16, 38, 20)
    rest(img, body, 4, 6)
    fur = rgb('c9a074')
    fill(img, Capsule(x + 30, y - 6, x - 8, y - 4, 9), shift(fur, -0.14), light=SOFT)
    fill(img, body, linear(0, y - 36, 0, y + 4, [(0, shift(fur, 0.14)), (1, shift(fur, -0.2))]), light=LIGHT)
    for dx in (-31, -15):
        fill(img, Poly([(x + dx, y - 34), (x + dx + 11, y - 34), (x + dx + 5, y - 48)], r=3), shift(fur, -0.05), light=SOFT)
    head = Ellipse(x - 22, y - 28, 20, 17)
    fill(img, head, shift(fur, 0.1), light=LIGHT)
    fill(img, Ellipse(x - 24, y - 24, 9, 6), shift(CREAM, -0.06), alpha=0.7)
    for dx in (-29, -16):
        fill(img, Capsule(x + dx - 4, y - 30, x + dx + 4, y - 30, 2.6), shift(INK, 0.1))
    fill(img, Ellipse(x - 22, y - 24, 3, 2.4), shift(CLAY, -0.1))
    fill(img, Ellipse(x + 8, y - 22, 20, 11), shift(fur, 0.2), alpha=0.45)
    return img


def duck():
    img = Image(CELL, CELL)
    x, y = BASE
    body = Ellipse(x, y - 15, 24, 16)
    rest(img, body, 3, 5)
    fill(img, Ellipse(x - 16, y - 12, 12, 9), shift(MUSTARD, -0.1), light=SOFT)
    fill(img, body, MUSTARD, light=LIGHT)
    head = Ellipse(x + 12, y - 32, 15, 14)
    fill(img, head, shift(MUSTARD, 0.08), light=LIGHT)
    fill(img, Poly([(x + 24, y - 33), (x + 38, y - 30), (x + 24, y - 26)], r=3), CLAY, light=SOFT)
    fill(img, Ellipse(x + 15, y - 36, 2.6, 3), shift(INK, 0.1))
    fill(img, Ellipse(x - 4, y - 20, 12, 7), shift(MUSTARD, 0.26), alpha=0.5)
    return img


def trophy():
    img = Image(CELL, CELL)
    x, y = BASE
    plinth = Rect(x - 20, y - 14, 40, 14, 3)
    rest(img, plinth, 3, 5)
    fill(img, plinth, shift(WOOD, -0.24), light=LIGHT)
    fill(img, Capsule(x, y - 16, x, y - 32, 6), shift(MUSTARD, -0.12), light=SOFT)
    cup = Poly([(x - 20, y - 62), (x + 20, y - 62), (x + 11, y - 30), (x - 11, y - 30)], r=6)
    fill(img, cup, linear(x - 20, 0, x + 20, 0, [(0, shift(MUSTARD, 0.3)), (1, shift(MUSTARD, -0.3))]), light=LIGHT)
    for dx in (-25, 25):
        fill(img, Grow(Ellipse(x + dx, y - 52, 11, 11), 0) - Grow(Ellipse(x + dx, y - 52, 6, 6), 0), shift(MUSTARD, -0.05), light=SOFT)
    fill(img, Rect(x - 14, y - 10, 28, 5, 2), shift(CREAM, -0.16), alpha=0.8)
    return img


def speaker():
    img = Image(CELL, CELL)
    x, y = BASE
    body = Rect(x - 34, y - 32, 68, 32, 12)
    rest(img, body, 3, 5)
    fill(img, body, shift(SLATE, -0.18), light=LIGHT)
    mesh = Rect(x - 28, y - 27, 56, 22, 9)
    fill(img, mesh, shift(INK, 0.16))
    for i in range(9):
        fill(img, Rect(x - 26 + i * 6.4, y - 25, 2.6, 18, 1.2), shift(INK, 0.32), alpha=0.8, clip=mesh)
    fill(img, Ellipse(x + 22, y - 30, 3, 3), shift(LEAF_LIT, 0.2))
    return img


def stickies():
    img = Image(CELL, CELL)
    x, y = BASE
    for dx, dy, rot, colr in ((-22, -2, -0.12, MUSTARD), (6, -8, 0.1, rgb('a8c98f')), (24, 2, -0.05, rgb('e0a0a8'))):
        cx, cy = x + dx, y + dy - 16
        c, s = math.cos(rot), math.sin(rot)
        pts = [(cx + px * c - py * s, cy + px * s + py * c) for px, py in ((-19, -17), (19, -17), (19, 17), (-19, 17))]
        note = Poly(pts, r=2)
        rest(img, note, 3, 4, 0.26)
        fill(img, note, colr, light=SOFT)
        for i in range(3):
            fill(img, Rect(cx - 12, cy - 8 + i * 7, 22 - i * 5, 2.2, 1), shift(colr, -0.4), alpha=0.5)
    return img


def terrarium():
    img = Image(CELL, CELL)
    x, y = BASE
    dish = Rect(x - 28, y - 12, 56, 12, 5)
    rest(img, dish, 3, 5)
    fill(img, dish, shift(WOOD, -0.12), light=LIGHT)
    fill(img, Ellipse(x, y - 14, 22, 7), shift(CLAY, -0.35))
    fill(img, Ellipse(x - 6, y - 20, 11, 9), LEAF, light=SOFT)
    fill(img, Ellipse(x + 8, y - 24, 9, 8), LEAF_LIT, light=SOFT)
    dome = Ellipse(x, y - 26, 27, 30) & Rect(x - 28, y - 62, 56, 50)
    fill(img, dome, rgb('cfe6e4'), alpha=0.34)
    outline(img, dome, rgb('e8f2ef'), 3, alpha=0.7)
    fill(img, Capsule(x - 14, y - 22, x - 6, y - 46, 5), (255, 255, 255), alpha=0.28)
    fill(img, Ellipse(x, y - 58, 5, 5), shift(WOOD, 0.1), light=SOFT)
    return img


ITEMS = [
    ('monitor', 'Monitor', monitor),
    ('laptop', 'Laptop', laptop),
    ('keyboard', 'Keyboard', keyboard),
    ('mug', 'Mug', mug),
    ('lamp', 'Desk lamp', desk_lamp),
    ('succulent', 'Succulent', succulent),
    ('cactus', 'Cactus', cactus),
    ('books', 'Books', books),
    ('photo', 'Photo frame', photo),
    ('notepad', 'Notepad', notepad),
    ('pencils', 'Pencil cup', pencils),
    ('headphones', 'Headphones', headphones),
    ('cat', 'Office cat', cat),
    ('duck', 'Rubber duck', duck),
    ('trophy', 'Trophy', trophy),
    ('speaker', 'Speaker', speaker),
    ('stickies', 'Sticky notes', stickies),
    ('terrarium', 'Terrarium', terrarium),
]


def build():
    rows = (len(ITEMS) + COLUMNS - 1) // COLUMNS
    atlas = Image(COLUMNS * CELL, rows * CELL)
    manifest = {
        'cell': CELL,
        'columns': COLUMNS,
        'scale': 4,
        'anchor': list(ANCHOR),
        'items': [],
    }
    for i, (name, label, render) in enumerate(ITEMS):
        atlas.paste(render(), (i % COLUMNS) * CELL, (i // COLUMNS) * CELL)
        manifest['items'].append({'name': name, 'label': label, 'frame': i})
    return atlas, manifest
