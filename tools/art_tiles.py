"""Office tileset. Every piece is drawn at TILE resolution and scaled down by the
renderer, so the world keeps its 32px grid while the art gains four times the detail.
"""

import math

from draw import (
    Capsule,
    Ellipse,
    Grow,
    Image,
    Move,
    Poly,
    Rect,
    fill,
    grain,
    linear,
    outline,
    radial,
    rgb,
    shadow,
    shift,
    stripes,
)

TILE = 128
LIGHT = (-2.4, -2.8, 0.40, 10)
SOFT = (-2.0, -2.4, 0.22, 16)

OAK = rgb('ca9a64')
OAK_DARK = rgb('9c7c55')
STONE = rgb('dcd6c4')
WALL = rgb('76917d')
WALL_LIT = rgb('abc1a0')
TRIM = rgb('e6e2d2')
INK = rgb('333d36')
WOOD = rgb('c88c52')
WOOD_DARK = rgb('7d5b3c')
LEAF = rgb('5f8a55')
LEAF_LIT = rgb('86ac6a')
LEAF_DARK = rgb('3f6440')
TEAL = rgb('6d9089')
SLATE = rgb('5c7484')
CLAY = rgb('c4826a')
MUSTARD = rgb('dfb066')
CREAM = rgb('f0ebda')


def piece(w=1, h=1):
    return Image(w * TILE, h * TILE)


def ground(img, shape, dy=5, blur=7, alpha=0.34, spread=1.0):
    shadow(img, shape, (38, 46, 40), 1.5, dy, blur, alpha, spread)


# --- floors ---------------------------------------------------------------


def floor_wood(stagger=0):
    img = piece()
    fill(img, Rect(0, 0, TILE, TILE), OAK)
    # Three quiet planks: sparse deliberate grain, no per-pixel noise.
    for i, (y, height) in enumerate(((0, 40), (40, 44), (84, 44))):
        tone = shift(OAK, (-0.04, 0.03, 0)[i])
        fill(img, Rect(0, y, TILE, height), tone)
        fill(img, Rect(0, y, TILE, 4), shift(tone, -0.13))
        fill(img, Rect(0, y + 4, TILE, 4), shift(tone, 0.08))
        end = ((i * 44 + stagger * 60) % 112) + 8
        fill(img, Rect(end, y, 4, height), shift(tone, -0.13))
        for j in range(2):
            gx = (i * 28 + j * 64 + stagger * 24) % 100
            fill(img, Rect(gx, y + 16 + j * 12, 20 + i * 4, 4), shift(tone, 0.07 if j else -0.06))
    return img


def floor_stone():
    img = piece()
    fill(img, Rect(0, 0, TILE, TILE), grain(STONE, 0.035, 0.12, 21, 2))
    for n in range(90):
        x = ((n * 71 + 13) % 121) + 3
        y = ((n * 47 + 29) % 121) + 3
        r = 1.1 + (n % 5) * 0.5
        tint = (shift(STONE, -0.22), shift(STONE, 0.16), rgb('b6b7a2'), rgb('cbb79c'))[n % 4]
        fill(img, Ellipse(x, y, r, r * 0.8), tint, alpha=0.5)
    fill(img, Rect(0, 0, TILE, 1.6), shift(STONE, -0.14), alpha=0.6)
    fill(img, Rect(0, 0, 1.6, TILE), shift(STONE, -0.14), alpha=0.6)
    fill(img, Rect(2, 2, TILE - 4, 2), shift(STONE, 0.3), alpha=0.5)
    return img


def floor_kitchen():
    img = piece()
    pale, sage = rgb('e8e3d4'), rgb('bcc6b6')
    fill(img, Rect(0, 0, TILE, TILE), grain(pale, 0.02, 0.2, 3, 2))
    for cx, cy in ((0, 0), (64, 64)):
        fill(img, Rect(cx + 1.5, cy + 1.5, 61, 61, 3), grain(sage, 0.03, 0.2, 9, 2), light=(-2, -2.4, 0.08, 20))
    for cx, cy in ((64, 0), (0, 64)):
        fill(img, Rect(cx + 1.5, cy + 1.5, 61, 61, 3), grain(pale, 0.03, 0.2, 17, 2), light=(-2, -2.4, 0.08, 20))
    return img


# --- rug ------------------------------------------------------------------


def rug_cell(col, row):
    img = piece()
    span = 3 * TILE
    body = Move(Rect(6, 6, span - 12, span - 12, 26), -col * TILE, -row * TILE)
    ground(img, body, dy=4, blur=8, alpha=0.26, spread=0)
    fill(img, body, grain(SLATE, 0.06, 0.1, 33, 3), light=(-3, -3, 0.16, 7))
    inner = Move(Rect(20, 20, span - 40, span - 40, 16), -col * TILE, -row * TILE)
    outline(img, inner, shift(CREAM, -0.05), 5, alpha=0.6)
    outline(img, Grow(inner, 9), shift(SLATE, -0.3), 2.5, alpha=0.5)
    cx = span / 2 - col * TILE
    cy = span / 2 - row * TILE
    for k, r in enumerate((70, 46, 22)):
        colr = (shift(SLATE, 0.26), MUSTARD, shift(CREAM, -0.02))[k]
        outline(img, Poly([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]), colr, 4, 0.5)
    fill(img, Ellipse(cx, cy, 9, 9), shift(CREAM, -0.02), alpha=0.6)
    return img


# --- walls ----------------------------------------------------------------


def wall_base(img):
    fill(
        img,
        Rect(0, 0, TILE, TILE),
        grain(linear(0, 0, 0, TILE, [(0, WALL_LIT), (0.55, WALL), (1, shift(WALL, -0.18))]), 0.016, 0.05, 41, 2),
    )
    fill(img, Rect(0, 0, TILE, 3), shift(WALL_LIT, 0.2), alpha=0.5)
    fill(img, Rect(0, TILE - 4, TILE, 4), shift(WALL, -0.42), alpha=0.6)
    return img


def wall():
    return wall_base(piece())


def wall_window():
    img = wall_base(piece())
    frame = Rect(12, 16, TILE - 24, 84, 7)
    shadow(img, frame, (30, 38, 33), 2, 4, 6, 0.35, 1)
    fill(img, frame, shift(WALL, -0.35), light=LIGHT)
    glass = Rect(18, 22, TILE - 36, 72, 4)
    fill(img, glass, linear(0, 22, 0, 94, [(0, rgb('bad8de')), (0.5, rgb('9cc0cd')), (1, rgb('dce9e0'))]))
    fill(img, Poly([(20, 94), (56, 22), (76, 22), (40, 94)]), (255, 255, 255), alpha=0.16, clip=glass)
    fill(img, Poly([(78, 94), (100, 50), (110, 50), (88, 94)]), (255, 255, 255), alpha=0.1, clip=glass)
    fill(img, Rect(62, 22, 4, 72), shift(WALL, -0.2), alpha=0.9)
    fill(img, Rect(18, 54, TILE - 36, 4), shift(WALL, -0.2), alpha=0.9)
    outline(img, glass, shift(INK, 0.1), 2.5, alpha=0.5)
    fill(img, Rect(8, 98, TILE - 16, 9, 3), TRIM, light=LIGHT)
    return img


def wall_art():
    img = wall_base(piece())
    frame = Rect(24, 20, 80, 66, 4)
    shadow(img, frame, (30, 38, 33), 2, 4, 5, 0.35, 1)
    fill(img, frame, shift(WOOD_DARK, 0.1), light=LIGHT)
    canvas = Rect(30, 26, 68, 54, 2)
    fill(img, canvas, CREAM)
    fill(img, Rect(30, 56, 68, 24), shift(LEAF, 0.1), clip=canvas)
    fill(img, Ellipse(56, 52, 26, 18), MUSTARD, clip=canvas, alpha=0.9)
    fill(img, Ellipse(78, 40, 12, 12), CLAY, clip=canvas, alpha=0.9)
    outline(img, canvas, shift(INK, 0.3), 1.6, alpha=0.4)
    return img


def wall_whiteboard():
    img = wall_base(piece())
    board = Rect(10, 14, TILE - 20, 78, 4)
    shadow(img, board, (30, 38, 33), 2, 5, 6, 0.35, 1)
    fill(img, board, shift(CREAM, 0.04), light=LIGHT)
    fill(img, Rect(14, 18, TILE - 28, 70, 2), rgb('fbf8ef'))
    for x0, y0, x1, y1 in ((24, 32, 62, 32), (24, 44, 78, 44), (24, 56, 50, 56)):
        fill(img, Capsule(x0, y0, x1, y1, 3), rgb('7f93a6'), alpha=0.65)
    fill(img, Capsule(84, 30, 104, 58, 3.4), CLAY, alpha=0.6)
    fill(img, Capsule(104, 30, 84, 58, 3.4), CLAY, alpha=0.6)
    fill(img, Rect(18, 88, TILE - 36, 8, 3), shift(WALL, -0.2), light=LIGHT)
    fill(img, Capsule(30, 92, 44, 92, 5), CLAY)
    fill(img, Capsule(52, 92, 66, 92, 5), rgb('6f93bd'))
    return img


def wall_door():
    img = wall_base(piece())
    frame = Rect(14, 8, TILE - 28, TILE - 12, 5)
    fill(img, frame, shift(TRIM, -0.12), light=LIGHT)
    door = Rect(21, 14, TILE - 42, TILE - 20, 3)
    fill(img, door, grain(WOOD, 0.05, 0.1, 61, 2), light=LIGHT)
    for y in (26, 74):
        panel = Rect(31, y, TILE - 62, 40, 3)
        fill(img, panel, shift(WOOD, -0.1))
        outline(img, panel, shift(WOOD, 0.22), 2, alpha=0.7)
    fill(img, Ellipse(96, 66, 5.5, 5.5), MUSTARD, light=LIGHT)
    return img


# --- furniture ------------------------------------------------------------


def desk():
    img = piece(2)
    top = Rect(8, 30, 240, 62, 10)
    ground(img, top, dy=9, blur=10, alpha=0.32, spread=2)
    for x in (34, 222):
        fill(img, Rect(x - 6, 78, 12, 30, 4), WOOD_DARK, light=SOFT)
    fill(img, Rect(10, 84, 236, 12, 5), shift(WOOD_DARK, 0.08), light=SOFT)
    fill(img, top, stripes(WOOD, 0.06, 26, 0.06, seed=3), light=LIGHT)
    fill(img, Rect(8, 78, 240, 14, 6), shift(WOOD, -0.24), light=SOFT)
    fill(img, Rect(14, 34, 228, 5, 3), shift(WOOD, 0.26), alpha=0.55)
    # The entire top is usable. Drawer and handle belong on the front apron.
    fill(img, Rect(148, 80, 88, 12), shift(WOOD, -0.32))
    fill(img, Rect(180, 82, 24, 4), CREAM)
    outline(img, top, WOOD_DARK, 4)
    return img


def chair(facing_up):
    img = piece()
    seat = Rect(28, 40, 72, 50, 16) if facing_up else Rect(28, 30, 72, 50, 16)
    back = Rect(32, 8, 64, 38, 15) if facing_up else Rect(30, 68, 68, 46, 18)
    ground(img, seat, dy=10, blur=10, alpha=0.3, spread=2)
    hub = 96 if facing_up else 88
    for a in range(5):
        t = a * math.tau / 5 + (0.9 if facing_up else 1.8)
        ex, ey = 64 + 38 * math.cos(t), hub + 24 * math.sin(t)
        fill(img, Capsule(64, hub, ex, ey, 7), shift(INK, 0.18), light=SOFT)
        fill(img, Ellipse(ex, ey, 6, 5), shift(INK, 0.05), light=SOFT)
    fill(img, Capsule(64, hub, 64, hub - 22, 9), shift(INK, 0.26), light=SOFT)
    fill(img, Ellipse(64, hub, 13, 10), shift(INK, 0.32), light=SOFT)
    if facing_up:
        fill(img, back, shift(TEAL, -0.14), light=LIGHT)
        fill(img, Grow(back, -6), shift(TEAL, 0.02), alpha=0.55)
    fill(img, seat, shift(TEAL, 0.06), light=LIGHT)
    fill(img, Grow(seat, -8), shift(TEAL, 0.18), alpha=0.5)
    fill(img, Capsule(40, seat.box[1] + 32, 88, seat.box[1] + 32, 3), shift(TEAL, -0.3), alpha=0.35)
    if not facing_up:
        shadow(img, back, (38, 46, 40), 0, -3, 6, 0.28, 1)
        fill(img, back, shift(TEAL, -0.04), light=LIGHT)
        fill(img, Grow(back, -8), shift(TEAL, 0.14), alpha=0.5)
        fill(img, Capsule(44, 92, 84, 92, 3), shift(TEAL, -0.28), alpha=0.35)
    return img


def plant_tall():
    img = piece()
    pot = Poly([(44, 74), (84, 74), (78, 118), (50, 118)], r=6)
    ground(img, pot, dy=6, blur=9, alpha=0.36, spread=2)
    fill(img, Capsule(64, 60, 64, 84, 7), shift(LEAF_DARK, 0.05))
    leaves = [
        (26, 44, 24, 15, -0.5), (100, 40, 24, 15, 0.5), (64, 16, 17, 24, 0.0),
        (36, 20, 20, 15, -0.8), (94, 18, 20, 15, 0.8), (44, 62, 20, 12, -0.3),
        (86, 60, 20, 12, 0.3),
    ]
    for cx, cy, rx, ry, tilt in leaves:
        blade = Ellipse(cx, cy, rx, ry)
        fill(img, Grow(blade, 1.5), LEAF_DARK, alpha=0.6)
        fill(img, blade, LEAF_LIT if cy < 40 else LEAF, light=(-2.4, -2.8, 0.34, 9))
        fill(img, Capsule(64, 66, cx, cy, 2.4), shift(LEAF_DARK, 0.12), alpha=0.65)
    fill(img, pot, linear(44, 0, 84, 0, [(0, shift(CLAY, 0.12)), (1, shift(CLAY, -0.22))]), light=LIGHT)
    fill(img, Rect(40, 68, 48, 12, 5), shift(CLAY, 0.16), light=LIGHT)
    fill(img, Ellipse(64, 72, 21, 5), shift(WOOD_DARK, -0.2), alpha=0.7)
    return img


def plant_small():
    img = piece()
    pot = Poly([(46, 82), (82, 82), (77, 114), (51, 114)], r=5)
    ground(img, pot, dy=5, blur=8, alpha=0.34, spread=1)
    bush = Ellipse(64, 62, 30, 24)
    fill(img, Grow(bush, 1.5), LEAF_DARK, alpha=0.55)
    fill(img, bush, LEAF, light=(-3, -3, 0.3, 12))
    for cx, cy, r in ((48, 54, 11), (76, 50, 12), (64, 44, 10), (56, 70, 9), (80, 68, 9)):
        fill(img, Ellipse(cx, cy, r, r * 0.85), shift(LEAF_LIT, 0.04), alpha=0.75, light=SOFT)
    fill(img, pot, linear(46, 0, 82, 0, [(0, shift(MUSTARD, 0.1)), (1, shift(MUSTARD, -0.26))]), light=LIGHT)
    fill(img, Rect(43, 78, 42, 10, 4), shift(MUSTARD, 0.14), light=LIGHT)
    return img


def bookshelf():
    img = piece()
    body = Rect(6, 6, TILE - 12, TILE - 14, 6)
    ground(img, body, dy=8, blur=9, alpha=0.34, spread=2)
    fill(img, body, grain(WOOD_DARK, 0.05, 0.1, 71, 2), light=LIGHT)
    fill(img, Grow(body, -5), shift(WOOD_DARK, -0.25))
    spines = ['c4826a', 'dfb066', '6d9089', 'f0ebda', '8a6fa8', '86ac6a', 'c9705f', 'a8b7c9']
    for row, y in enumerate((14, 60)):
        x = 14
        n = 0
        while x < TILE - 20:
            w = 8 + ((row * 5 + n * 7) % 4) * 3
            h = 34 - ((n * 3 + row) % 3) * 4
            colr = rgb(spines[(n + row * 3) % len(spines)])
            fill(img, Rect(x, y + (36 - h), w, h, 2), colr, light=(-1.6, -2, 0.3, 6))
            fill(img, Rect(x + 1.5, y + (36 - h) + 5, w - 3, 2.5), shift(colr, 0.35), alpha=0.7)
            x += w + 2.5
            n += 1
        fill(img, Rect(10, y + 36, TILE - 20, 7, 2), shift(WOOD, -0.05), light=SOFT)
    return img


def couch():
    img = piece(2)
    body = Rect(10, 22, 236, 88, 22)
    ground(img, body, dy=9, blur=11, alpha=0.32, spread=2)
    fill(img, body, shift(TEAL, -0.16), light=LIGHT)
    fill(img, Rect(20, 18, 216, 40, 16), stripes(shift(TEAL, 0.06), 0.04, 30, 1.4, seed=9), light=LIGHT)
    for i in range(2):
        cushion = Rect(28 + i * 100, 52, 96, 50, 14)
        fill(img, cushion, stripes(shift(TEAL, 0.16), 0.04, 26, 1.4, seed=4 + i), light=(-2.4, -2.8, 0.3, 12))
        outline(img, Grow(cushion, -6), shift(TEAL, -0.2), 2, alpha=0.35)
    for x in (10, 206):
        arm = Rect(x, 30, 40, 78, 18)
        fill(img, arm, shift(TEAL, -0.02), light=LIGHT)
        fill(img, Grow(arm, -8), shift(TEAL, 0.1), alpha=0.5)
    for cx, colr in ((66, MUSTARD), (188, CLAY)):
        pill = Rect(cx - 20, 40, 40, 34, 10)
        fill(img, pill, colr, light=(-2, -2.4, 0.3, 10))
        outline(img, Grow(pill, -5), shift(colr, -0.18), 1.8, alpha=0.4)
    return img


def table():
    img = piece(2)
    top = Ellipse(128, 64, 116, 50)
    ground(img, top, dy=10, blur=12, alpha=0.32, spread=2)
    fill(img, Capsule(128, 64, 128, 104, 18), shift(INK, 0.2), light=SOFT)
    fill(img, Ellipse(128, 106, 44, 14), shift(INK, 0.12), light=SOFT)
    fill(img, Move(top, 0, 7), shift(WOOD, -0.32))
    fill(img, top, stripes(WOOD, 0.05, 34, 1.5, seed=17), light=(-2.6, -3, 0.3, 14))
    outline(img, Grow(top, -7), shift(WOOD, 0.2), 2.5, alpha=0.45)
    fill(img, Ellipse(128, 58, 22, 12), shift(LEAF_DARK, 0.2), light=SOFT)
    fill(img, Ellipse(126, 50, 10, 9), LEAF_LIT, light=SOFT)
    fill(img, Ellipse(136, 54, 9, 8), LEAF, light=SOFT)
    return img


def counter():
    img = piece(2)
    body = Rect(6, 26, 244, 84, 8)
    ground(img, body, dy=9, blur=10, alpha=0.34, spread=2)
    fill(img, body, shift(TEAL, -0.34), light=LIGHT)
    fill(img, Rect(6, 26, 244, 26, 8), grain(STONE, 0.03, 0.15, 27, 2), light=LIGHT)
    for i in range(3):
        door = Rect(16 + i * 78, 58, 68, 44, 5)
        fill(img, door, shift(TEAL, -0.24), light=SOFT)
        fill(img, Capsule(34 + i * 78, 66, 66 + i * 78, 66, 5), shift(STONE, -0.1))
    machine = Rect(30, 6, 54, 48, 6)
    fill(img, machine, shift(INK, 0.12), light=LIGHT)
    fill(img, Rect(38, 14, 38, 16, 3), rgb('9ec6c0'), light=SOFT)
    fill(img, Rect(46, 36, 22, 14, 3), shift(INK, 0.3))
    fill(img, Ellipse(160, 30, 14, 10), CREAM, light=SOFT)
    fill(img, Ellipse(190, 32, 12, 9), MUSTARD, light=SOFT)
    return img


def cabinet():
    img = piece()
    body = Rect(14, 18, 100, 96, 6)
    ground(img, body, dy=8, blur=9, alpha=0.34, spread=2)
    fill(img, body, shift(STONE, -0.28), light=LIGHT)
    fill(img, Rect(14, 18, 100, 14, 6), shift(STONE, -0.1), light=SOFT)
    for i in range(3):
        drawer = Rect(20, 36 + i * 26, 88, 22, 4)
        fill(img, drawer, shift(STONE, -0.18), light=SOFT)
        fill(img, Capsule(50, 47 + i * 26, 78, 47 + i * 26, 5), shift(INK, 0.35))
    fill(img, Ellipse(64, 12, 20, 8), LEAF, light=SOFT)
    return img


def cooler():
    img = piece()
    body = Rect(36, 46, 56, 68, 7)
    ground(img, body, dy=6, blur=8, alpha=0.34, spread=1)
    fill(img, body, shift(CREAM, -0.12), light=LIGHT)
    bottle = Poly([(46, 46), (82, 46), (76, 12), (52, 12)], r=6)
    fill(img, bottle, rgb('a8cfd6'), light=(-2.4, -2.8, 0.34, 10), alpha=0.92)
    fill(img, Rect(48, 24, 32, 22, 4), rgb('7fb4c2'), alpha=0.8)
    fill(img, Rect(44, 60, 40, 16, 3), shift(INK, 0.3), light=SOFT)
    fill(img, Capsule(64, 76, 64, 84, 5), shift(INK, 0.4))
    return img


def stool():
    img = piece()
    seat = Ellipse(64, 58, 34, 26)
    ground(img, seat, dy=8, blur=9, alpha=0.3, spread=1)
    for dx in (-22, 0, 22):
        fill(img, Capsule(64 + dx * 0.3, 66, 64 + dx, 106, 6), shift(WOOD_DARK, 0.06))
    fill(img, Move(seat, 0, 6), shift(CLAY, -0.35))
    fill(img, seat, CLAY, light=(-2.4, -2.8, 0.32, 12))
    outline(img, Grow(seat, -6), shift(CLAY, -0.16), 2, alpha=0.35)
    return img


def lamp_floor():
    img = piece()
    base = Ellipse(64, 108, 26, 10)
    ground(img, base, dy=4, blur=7, alpha=0.32, spread=1)
    fill(img, base, shift(INK, 0.2), light=SOFT)
    fill(img, Capsule(64, 104, 64, 46, 5), shift(INK, 0.3))
    shade = Poly([(38, 44), (90, 44), (80, 10), (48, 10)], r=6)
    fill(img, Grow(shade, 6), MUSTARD, alpha=0.14, softness=6)
    fill(img, shade, linear(0, 10, 0, 44, [(0, shift(CREAM, 0.02)), (1, shift(MUSTARD, -0.05))]), light=LIGHT)
    fill(img, Rect(38, 40, 52, 5, 2), shift(MUSTARD, 0.3), alpha=0.8)
    return img


def divider():
    img = piece()
    box = Rect(10, 60, TILE - 20, 52, 6)
    ground(img, box, dy=6, blur=9, alpha=0.34, spread=2)
    for cx, cy, rx, ry in ((26, 46, 20, 16), (58, 34, 24, 18), (96, 44, 22, 17), (76, 58, 20, 14), (36, 62, 18, 13)):
        fill(img, Grow(Ellipse(cx, cy, rx, ry), 1.5), LEAF_DARK, alpha=0.5)
        fill(img, Ellipse(cx, cy, rx, ry), LEAF if cx % 3 else LEAF_LIT, light=(-2.4, -2.8, 0.3, 10))
    fill(img, box, grain(WOOD_DARK, 0.05, 0.12, 83, 2), light=LIGHT)
    fill(img, Rect(14, 64, TILE - 28, 6, 3), shift(WOOD, 0.05), alpha=0.6)
    return img


PIECES = [
    ('floor.wood', 1, lambda: floor_wood(0)),
    ('floor.wood.alt', 1, lambda: floor_wood(1)),
    ('floor.stone', 1, floor_stone),
    ('floor.kitchen', 1, floor_kitchen),
    ('wall', 1, wall),
    ('wall.window', 1, wall_window),
    ('wall.art', 1, wall_art),
    ('wall.board', 1, wall_whiteboard),
    ('wall.door', 1, wall_door),
    ('rug.tl', 1, lambda: rug_cell(0, 0)),
    ('rug.t', 1, lambda: rug_cell(1, 0)),
    ('rug.tr', 1, lambda: rug_cell(2, 0)),
    ('rug.l', 1, lambda: rug_cell(0, 1)),
    ('rug.c', 1, lambda: rug_cell(1, 1)),
    ('rug.r', 1, lambda: rug_cell(2, 1)),
    ('rug.bl', 1, lambda: rug_cell(0, 2)),
    ('rug.b', 1, lambda: rug_cell(1, 2)),
    ('rug.br', 1, lambda: rug_cell(2, 2)),
    ('desk', 2, desk),
    ('couch', 2, couch),
    ('table', 2, table),
    ('counter', 2, counter),
    ('chair.up', 1, lambda: chair(True)),
    ('chair.down', 1, lambda: chair(False)),
    ('plant.tall', 1, plant_tall),
    ('plant.small', 1, plant_small),
    ('bookshelf', 1, bookshelf),
    ('cabinet', 1, cabinet),
    ('cooler', 1, cooler),
    ('stool', 1, stool),
    ('lamp', 1, lamp_floor),
    ('divider', 1, divider),
]
COLUMNS = 8


def build():
    """Packs the pieces into an 8-column atlas, keeping multi-tile pieces on one row."""
    slots = []
    for name, width, _ in PIECES:
        if len(slots) % COLUMNS + width > COLUMNS:
            slots.append(None)
        slots.extend([name] * width)
    rows = (len(slots) + COLUMNS - 1) // COLUMNS
    atlas = Image(COLUMNS * TILE, rows * TILE)
    gids = {}
    cursor = 0
    for name, width, render in PIECES:
        while slots[cursor] is None:
            cursor += 1
        art = render()
        for i in range(width):
            cell = cursor + i
            atlas.paste(
                _crop(art, i * TILE, TILE),
                (cell % COLUMNS) * TILE,
                (cell // COLUMNS) * TILE,
            )
            gids[name if width == 1 else f'{name}.{i}'] = cell + 1
        cursor += width
    return atlas, gids, len(slots)


def _crop(src, x0, width):
    out = Image(width, src.h)
    for y in range(src.h):
        row = (y * src.w + x0) * 4
        out.px[y * width * 4 : (y + 1) * width * 4] = src.px[row : row + width * 4]
    return out
