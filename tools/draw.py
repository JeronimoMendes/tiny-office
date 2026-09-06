"""Pixel rasterizer for code-authored art. Standard library only.

Geometry uses a 4x authoring grid; every 4x4 block is one hard-edged world pixel.
Discrete lighting bands and stepped alpha keep the artwork crisp at game scale.
"""

import math
import struct
import zlib
from pathlib import Path


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def mix(a, b, t):
    return a + (b - a) * t


def rgb(hexcolor):
    return tuple(int(hexcolor[i : i + 2], 16) for i in (0, 2, 4))


def shift(color, amount):
    """Lighten (amount > 0) or darken a colour, keeping it inside the gamut."""
    if amount >= 0:
        return tuple(c + (255 - c) * amount for c in color)
    return tuple(c * (1 + amount) for c in color)


# --- shapes ---------------------------------------------------------------


class Shape:
    def bbox(self):
        raise NotImplementedError

    def sd(self, x, y):
        raise NotImplementedError

    def __or__(self, other):
        return Union(self, other)

    def __and__(self, other):
        return Intersect(self, other)

    def __sub__(self, other):
        return Subtract(self, other)


class Rect(Shape):
    def __init__(self, x, y, w, h, r=0.0):
        self.cx, self.cy = x + w / 2, y + h / 2
        self.hw, self.hh = max(w / 2 - r, 0.0), max(h / 2 - r, 0.0)
        self.r = min(r, w / 2, h / 2)
        self.box = (x, y, x + w, y + h)

    def bbox(self):
        return self.box

    def sd(self, x, y):
        dx = abs(x - self.cx) - self.hw
        dy = abs(y - self.cy) - self.hh
        if dx > 0.0 and dy > 0.0:
            return math.hypot(dx, dy) - self.r
        return max(dx, dy) - self.r


class Ellipse(Shape):
    def __init__(self, cx, cy, rx, ry):
        self.cx, self.cy, self.rx, self.ry = cx, cy, max(rx, 0.01), max(ry, 0.01)

    def bbox(self):
        return (self.cx - self.rx, self.cy - self.ry, self.cx + self.rx, self.cy + self.ry)

    def sd(self, x, y):
        # Scaled-space approximation: exact for circles, close enough for AA.
        u, v = (x - self.cx) / self.rx, (y - self.cy) / self.ry
        k = math.hypot(u, v)
        return (k - 1.0) * min(self.rx, self.ry) if k > 1e-6 else -min(self.rx, self.ry)


class Capsule(Shape):
    """Thick line segment with round caps."""

    def __init__(self, x0, y0, x1, y1, width):
        self.a, self.b, self.r = (x0, y0), (x1, y1), width / 2
        self.d = (x1 - x0, y1 - y0)
        self.len2 = self.d[0] ** 2 + self.d[1] ** 2 or 1e-6

    def bbox(self):
        return (
            min(self.a[0], self.b[0]) - self.r,
            min(self.a[1], self.b[1]) - self.r,
            max(self.a[0], self.b[0]) + self.r,
            max(self.a[1], self.b[1]) + self.r,
        )

    def sd(self, x, y):
        px, py = x - self.a[0], y - self.a[1]
        t = clamp((px * self.d[0] + py * self.d[1]) / self.len2)
        return math.hypot(px - self.d[0] * t, py - self.d[1] * t) - self.r


class Poly(Shape):
    def __init__(self, points, r=0.0):
        self.p = list(points)
        self.r = r
        xs = [p[0] for p in self.p]
        ys = [p[1] for p in self.p]
        self.box = (min(xs) - r, min(ys) - r, max(xs) + r, max(ys) + r)

    def bbox(self):
        return self.box

    def sd(self, x, y):
        p = self.p
        n = len(p)
        d = float('inf')
        inside = False
        for i in range(n):
            ax, ay = p[i]
            bx, by = p[i - 1]
            ex, ey = bx - ax, by - ay
            wx, wy = x - ax, y - ay
            t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey or 1e-6))
            d = min(d, (wx - ex * t) ** 2 + (wy - ey * t) ** 2)
            if (ay > y) != (by > y) and wx < ex * (y - ay) / (ey or 1e-6):
                inside = not inside
        return (-math.sqrt(d) if inside else math.sqrt(d)) - self.r


class Union(Shape):
    def __init__(self, a, b):
        self.a, self.b = a, b

    def bbox(self):
        p, q = self.a.bbox(), self.b.bbox()
        return (min(p[0], q[0]), min(p[1], q[1]), max(p[2], q[2]), max(p[3], q[3]))

    def sd(self, x, y):
        return min(self.a.sd(x, y), self.b.sd(x, y))


class Intersect(Shape):
    def __init__(self, a, b):
        self.a, self.b = a, b

    def bbox(self):
        p, q = self.a.bbox(), self.b.bbox()
        return (max(p[0], q[0]), max(p[1], q[1]), min(p[2], q[2]), min(p[3], q[3]))

    def sd(self, x, y):
        return max(self.a.sd(x, y), self.b.sd(x, y))


class Subtract(Shape):
    def __init__(self, a, b):
        self.a, self.b = a, b

    def bbox(self):
        return self.a.bbox()

    def sd(self, x, y):
        return max(self.a.sd(x, y), -self.b.sd(x, y))


class Grow(Shape):
    """Offsets a shape's outline outwards (or inwards for a negative amount)."""

    def __init__(self, shape, amount):
        self.s, self.k = shape, amount

    def bbox(self):
        x0, y0, x1, y1 = self.s.bbox()
        return (x0 - self.k, y0 - self.k, x1 + self.k, y1 + self.k)

    def sd(self, x, y):
        return self.s.sd(x, y) - self.k


class Move(Shape):
    def __init__(self, shape, dx, dy):
        self.s, self.dx, self.dy = shape, dx, dy

    def bbox(self):
        x0, y0, x1, y1 = self.s.bbox()
        return (x0 + self.dx, y0 + self.dy, x1 + self.dx, y1 + self.dy)

    def sd(self, x, y):
        return self.s.sd(x - self.dx, y - self.dy)


# --- paints ---------------------------------------------------------------


def linear(x0, y0, x1, y1, stops):
    dx, dy = x1 - x0, y1 - y0
    span = dx * dx + dy * dy or 1e-6
    stops = sorted(stops)

    def paint(x, y):
        t = clamp(((x - x0) * dx + (y - y0) * dy) / span)
        for i in range(1, len(stops)):
            if t <= stops[i][0] or i == len(stops) - 1:
                (t0, c0), (t1, c1) = stops[i - 1], stops[i]
                k = clamp((t - t0) / (t1 - t0)) if t1 > t0 else 0.0
                return (mix(c0[0], c1[0], k), mix(c0[1], c1[1], k), mix(c0[2], c1[2], k))
        return stops[0][1]

    return paint


def radial(cx, cy, r, inner, outer):
    def paint(x, y):
        t = clamp(math.hypot(x - cx, y - cy) / r)
        return tuple(mix(inner[i], outer[i], t) for i in range(3))

    return paint


def _hash2(ix, iy, seed):
    n = (ix * 374761393 + iy * 668265263 + seed * 1013904223) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def value_noise(x, y, seed=0):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    return mix(
        mix(_hash2(ix, iy, seed), _hash2(ix + 1, iy, seed), sx),
        mix(_hash2(ix, iy + 1, seed), _hash2(ix + 1, iy + 1, seed), sx),
        sy,
    )


def fbm(x, y, seed=0, octaves=3):
    total, amp, norm = 0.0, 1.0, 0.0
    for o in range(octaves):
        total += amp * value_noise(x * (2**o), y * (2**o), seed + o * 37)
        norm += amp
        amp *= 0.5
    return total / norm


def grain(base, amount, scale=1.0, seed=0, octaves=2):
    """Speckles a paint with fractal noise. `base` may be a colour or a paint."""
    solid = not callable(base)

    def paint(x, y):
        c = base if solid else base(x, y)
        k = 1.0 + (fbm(x * scale, y * scale, seed, octaves) - 0.5) * 2 * amount
        return (clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255))

    return paint


def stripes(base, amount, period, angle=0.0, seed=0):
    """Directional streaks — wood grain, brushed fabric, upholstery ribbing."""
    solid = not callable(base)
    ca, sa = math.cos(angle), math.sin(angle)

    def paint(x, y):
        c = base if solid else base(x, y)
        u = x * ca + y * sa
        v = x * -sa + y * ca
        k = 1.0 + amount * (
            math.sin(u * math.tau / period + fbm(u * 0.08, v * 0.5, seed) * 6.0) * 0.5
            + (fbm(u * 0.5, v * 0.03, seed + 11) - 0.5)
        )
        return (clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255))

    return paint


# --- canvas ---------------------------------------------------------------


class Image:
    __slots__ = ('w', 'h', 'px')

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [0.0] * (w * h * 4)

    def blend(self, x, y, r, g, b, a):
        if a <= 0.0 or not (0 <= x < self.w and 0 <= y < self.h):
            return
        i = (y * self.w + x) * 4
        px = self.px
        da = px[i + 3]
        oa = a + da * (1.0 - a)
        if oa <= 0.0:
            return
        k = da * (1.0 - a) / oa
        j = a / oa
        px[i] = r * j + px[i] * k
        px[i + 1] = g * j + px[i + 1] * k
        px[i + 2] = b * j + px[i + 2] * k
        px[i + 3] = oa

    def paste(self, src, ox, oy):
        for y in range(src.h):
            row = (y * src.w) * 4
            for x in range(src.w):
                i = row + x * 4
                self.blend(ox + x, oy + y, src.px[i], src.px[i + 1], src.px[i + 2], src.px[i + 3])


def fill(img, shape, paint, alpha=1.0, light=None, clip=None, softness=0.0):
    """Composites `shape` onto `img`.

    light: (dx, dy, strength, depth) bevels the shape by comparing the distance
    field along the light vector — positive strength lifts the lit edge.
    softness: widens the edge falloff, turning a shape into a blurred blob.
    """
    x0, y0, x1, y1 = shape.bbox()
    pad = 1.0 + softness
    x0, y0 = max(0, int(x0 - pad)), max(0, int(y0 - pad))
    x1, y1 = min(img.w, int(x1 + pad) + 1), min(img.h, int(y1 + pad) + 1)
    if x0 >= x1 or y0 >= y1:
        return
    sd = shape.sd
    solid = not callable(paint)
    r = g = b = 0.0
    if solid:
        r, g, b = paint
    half = 0.5 + softness
    inv = 1.0 / (2.0 * half)
    clip_sd = clip.sd if clip is not None else None
    if light:
        lx, ly, strength, depth = light
        llen = math.hypot(lx, ly) or 1.0
    for y in range(y0 // 4 * 4, y1, 4):
        py = y + 2
        for x in range(x0 // 4 * 4, x1, 4):
            pxc = x + 2
            d = sd(pxc, py)
            if d >= half:
                continue
            cov = (1.0 if d <= 0 else 0.0) if not softness else round(clamp((half - d) * inv) * 3) / 3
            if cov <= 0.0:
                continue
            if clip_sd is not None:
                cov *= 1.0 if clip_sd(pxc, py) <= 0 else 0.0
                if cov <= 0.0:
                    continue
            cr, cg, cb = (r, g, b) if solid else paint(pxc, py)
            if light:
                n = clamp((sd(pxc + lx, py + ly) - d) / llen, -1.0, 1.0)
                m = 1.0 + strength * n * (clamp(1.0 + d / depth) if depth else 1.0)
                m = round(m * 5) / 5
                cr, cg, cb = clamp(cr * m, 0, 255), clamp(cg * m, 0, 255), clamp(cb * m, 0, 255)
            cr, cg, cb = (round(c / 8) * 8 for c in (cr, cg, cb))
            for yy in range(y, min(y + 4, img.h)):
                for xx in range(x, min(x + 4, img.w)):
                    img.blend(xx, yy, cr, cg, cb, cov * alpha)


def outline(img, shape, paint, width=1.0, alpha=1.0, clip=None):
    fill(img, Grow(shape, width / 2) - Grow(shape, -width / 2), paint, alpha, clip=clip)


def shadow(img, shape, color, dx=0.0, dy=0.0, blur=4.0, alpha=0.3, spread=0.0, clip=None):
    fill(img, Move(Grow(shape, spread), dx, dy), color, alpha, clip=clip, softness=blur)


# --- png ------------------------------------------------------------------


def _filtered(raw, stride):
    """PNG Sub filter suits repeated pixel blocks and keeps regeneration fast."""
    out = bytearray()
    for start in range(0, len(raw), stride):
        line = raw[start:start + stride]
        out.append(1)
        out.extend((v - (line[i - 4] if i >= 4 else 0)) & 255 for i, v in enumerate(line))
    return bytes(out)


def write_png(path, img):
    def chunk(kind, data):
        return (
            struct.pack('!I', len(data))
            + kind
            + data
            + struct.pack('!I', zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    stride = img.w * 4
    raw = bytearray(len(img.px))
    px = img.px
    for i in range(0, len(px), 4):
        a = px[i + 3]
        raw[i] = int(clamp(px[i], 0, 255) + 0.5)
        raw[i + 1] = int(clamp(px[i + 1], 0, 255) + 0.5)
        raw[i + 2] = int(clamp(px[i + 2], 0, 255) + 0.5)
        raw[i + 3] = int(clamp(a, 0, 1) * 255 + 0.5)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('!2I5B', img.w, img.h, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(_filtered(bytes(raw), stride), 9))
        + chunk(b'IEND', b'')
    )
