---
name: tiny-office-prop
description: Draw a new piece of office furniture or decor for tiny-office as pixel art and wire it into the map editor. The input is the object to draw, e.g. "beanbag", "desk fan", "whiteboard". Use when asked to create a sprite, pixel art, or a new object/prop for the office.
---

# Draw a piece of office decor

The input to this skill is the object to draw. If none was given, ask for one
before starting — everything here depends on knowing what the thing is.

## Read the art guide first

[assets/ART.md](../../../assets/ART.md) is the contract. The rule that shapes
everything below: **the art is the source**. Nothing generates it and nothing
rebuilds it. A piece is a PNG you draw, and drawing it _is_ the authoring step —
there is no packing pass, no atlas to regenerate, no Python to write.

## Draw at the size it will actually be

A piece is drawn at world resolution: **32px to the tile**. A two-by-two piece
is 64 × 64, a single tile is 32 × 32. That is also exactly the size it appears
on screen at default zoom, so what you draw is what players see — no downsample
to hide behind, and no detail budget beyond the pixels you place.

Use the `pixel-art` MCP server, which this project configures to export into
`assets/sprites`:

- `create_canvas` at the piece's real size
- `fill_rect` for horizontal runs, `draw_line` for diagonals, `set_pixel` to
  finish corners
- `get_canvas` returns a character grid with a colour legend

**Read the grid before believing the art.** It is the only view that shows one
pixel per character, and it catches what a scaled-up preview hides. A real
example: a rug's whiskers were drawn as gentle diagonals and looked fine
magnified, but the grid showed them stair-stepping into scattered single pixels.
Flat horizontal runs fixed it. Thin sloped lines rarely survive at this scale.

Draw the two or three features that identify the object and let the rest be
volume and shadow.

## Match the office

Reuse the palette the office already has. Sampling an existing sheet with
`get_pixel` beats inventing a hue. The staples:

| Role       | Hex      |
| ---------- | -------- |
| Oak floor  | `ca9a64` |
| Sage wall  | `76917d` |
| Warm wood  | `c88c52` |
| Terracotta | `c4826a` |
| Mustard    | `dfb066` |
| Sage leaf  | `5f8a55` |
| Slate      | `5c7484` |
| Cream      | `f0ebda` |
| Ink        | `333d36` |

Light falls from the top-left everywhere in this office. Give a piece a lighter
1px rim along its top-left edge and a darker one along its bottom-right; that
alone does most of the work of making it sit in the room. Decor that rests on
the floor reads better with a soft contact edge underneath rather than a hard
outline.

## Export it

`export_png` writes to `assets/sprites/<name>.png`. Use a lowercase, hyphenated
name — it becomes a URL, and the map schema rejects anything else.

## Register it

Add one entry to `decorChoices` in
[apps/client/src/ui/MapEditor.tsx](../../../apps/client/src/ui/MapEditor.tsx):

```ts
{ name: 'cat-rug', label: 'Cat rug', sprite: 'cat-rug', width: 2, height: 2 },
```

`sprite` names the PNG, `width`/`height` are the footprint in tiles, and `solid`
(default false) decides whether it blocks movement — furniture usually does, a
rug does not. Solid pieces contribute their rotated footprint to authoritative
collision, so only claim the tiles the object really occupies.

Note there is no `gid`. Tile-backed entries in that list still carry one; those
are the older pieces packed into `office-cozy.png`, and new work does not join
them.

## Look at it before believing it

Read the exported PNG back — at 32px per tile it renders small but honest. Then
check it against a neighbour: coherence with the set is most of the job, and a
piece that looks good alone can still be too saturated or too contrasty for the
room.

Faults that only appear at final scale, all of them real: a notch cut into a
front edge read as a hole punched through the sprite; a one-pixel step where a
base flared past a hinge read as ears sticking out; sloped 1px whiskers
disintegrated into dots.

## What this does not cover

Small desk items — the mug, the laptop, the pencil cup — are a different system:
frames packed into `assets/props.png` with contact anchors in `props.json`,
placed on desk surfaces rather than on the floor. Nothing can extend that sheet
any more, since the packer is gone and the `pixel-art` server can export a canvas
but cannot open an existing PNG to composite into one. Adding a desk item would
mean giving the props layer the same per-PNG treatment decor now has. Say so
rather than improvising if that is what was asked for.

## Check the work

```sh
npm run format
npm run typecheck
npm test
```

## See it in the office (optional)

Per [AGENTS.md](../../../AGENTS.md), never `compose up` in the main checkout —
`docker ps` usually shows a `tiny-office-*` stack already running there. Take a
worktree, which gets its own Compose project and port block:

```sh
wt switch --create <branch> -y
```

Uncommitted art does not travel with the worktree; copy the changed files
across, or commit first. Then, noting that `--yes` is a global flag and has to
precede the subcommand:

```sh
wt --yes -C <worktree> up -d
docker compose -p <project> logs app        # prints the bootstrap secret
```

Claim ownership over HTTP — the endpoint checks CSRF, so without an `Origin`
header matching `APP_ORIGIN` it answers `403 Invalid origin`, which reads
misleadingly like a bad secret:

```sh
curl -s -X POST <origin>/api/bootstrap -H 'content-type: application/json' \
  -H 'origin: <origin>' \
  --data-raw '{"secret":"...","email":"...","displayName":"..."}'
docker compose -p <project> exec -T app npm run auth:owner-link
```

The piece shows up under **Manage office → Edit workspace map**, in the decor
palette. When finished, `wt remove <branch>` takes the containers and the
database volume with it, deleting that office and its owner account.
