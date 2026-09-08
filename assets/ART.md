# Tiny Office artwork

Original pixel art with warm oak, sage walls, terracotta pots and slate upholstery. Characters use a 24 × 32 pixel canvas and a restrained palette.

The art in this directory is the source. It is checked in, not generated: nothing rebuilds it, so editing a file is how the art changes. New pieces are drawn as pixel art and added to `sprites/`, where each one stays its own PNG and needs no packing — see Hand-drawn sprites. The existing sheets keep the registration the sections below describe.

## Characters

`assets/avatars.json` records the eight presets, dimensions, direction order, foot anchor, layer order and layer sheets. All sheets have the same registration: 12 columns (down, left, right, up; three gait frames each) and eight preset rows. The middle frame is idle. Coordinates are authored at 4x, snapped to 4px blocks, and rendered at 1/4 scale.

The flattened `avatars.png` and `avatar-layers/` remain the preset reference exports. Those layers composite back to exactly the flattened sheet. The editor and Phaser use `wardrobe/` instead: independent transparent atlases with native 24 × 32 frames, 12 columns, and one row per style/color combination. Front and back hair surround the other layers; hands are separate from sleeves, and sandals reveal feet from the body layer. Skin is drawn only in the body, hands and head layers, so it always matches across the whole character.

Facial hair is its own layer between the head and the front hair, so a beard sits under a fringe and over the shirt, and it is tinted by `hairColor` rather than a colour of its own. `beard.png` follows the same registration as every other atlas: five styles times eight hair colours, with the None style occupying the first eight empty rows.

`packages/shared/src/wardrobe.json` is the shared, append-only option catalog. `appearance.ts` validates all indices, resolves old numeric characters to presets, and defines layer ordering and row registration for both renderers. The `wardrobe/` atlases carry one row per style/color combination in that catalog's order. Keep their layer slot order synchronized with `appearanceLayers`; unit tests check atlas dimensions and row bounds.

Profiles save an optional `appearance` record alongside the legacy character number. A null record uses the original preset. Database migration 2 adds the JSONB column without changing existing profiles. Protocol version 3 carries the record in member and player updates, including reconnect snapshots. Part indices are stable: append new options, and migrate existing records if ever reordering or removing options. A whole new slot needs the same care, since stored records are read back without revalidation: migration 4 backfills `beard` into every saved appearance, and the schema defaults the key so a client running older code can still save.

## Desks and props

Desktops are drawn empty, with drawer handles on their front aprons. `props.png` carries 19 independent transparent props and `props.json` supplies their frame IDs, scale and contact anchor. Props in the map's `props` object layer are positioned by their contact point in world pixels, sorted by that point's Y coordinate, and respect object/layer visibility. This permits off-grid placement and overlapping items without baking them into the desk image.

Each starter desk has a hidden `surfaces` rectangle with a stable `surfaceId` matching its desk zone ID. The rectangle covers only the desktop, not the chair, legs or surrounding call zone. Desk props reference that surface ID. These are authoring metadata, not editable state or new collision rules.

The built-in owner editor places these props off-grid and can associate them with a stable desk ID. Props can be moved and rotated independently; moving a desk zone carries its associated small items. Removing an item leaves the clean desktop object intact.

## Hand-drawn sprites

`sprites/` holds one PNG per hand-drawn piece at world resolution — 32px to the tile, so a two-by-two piece is 64 × 64. Nothing packs them into a sheet. A decor object names one in a `sprite` property instead of carrying `tileData`, and the renderer loads `/assets/sprites/<name>.png` and draws it over the object's rectangle, rotating and depth-sorting it exactly as tile-backed decor. The name is validated as a bare filename, since it becomes a URL.

So adding a piece is: draw the PNG, drop it in `sprites/`, and give it an entry in `assets/catalog.json` with `sprite` set instead of `gid`. Its size in tiles is whatever `width` and `height` say; the PNG is scaled to that rectangle, so draw it at exactly 32px per tile to keep the pixels square. The catalog is shared by the editor palette, desk-edit validation, rendering and collision. `cat-rug.png` is the first of these.

`office-cozy.png` also still carries a copy of the cat rug at tile IDs 37–40, from when it was packed into the atlas. Nothing references those cells now; they can go the next time that sheet is redrawn.

## Item bounds (post-processing)

Bounds refresh automatically before `npm run dev`, `npm run build` and `npm test`.
Development also watches PNGs and the prop manifest for changes. No manual command
is needed; `npm run assets:bounds` remains available for an explicit refresh.
This reads the finished artwork and writes `assets/item-bounds.json`; it never
creates or modifies artwork. Commit the PNGs and refreshed metadata together.
Export as non-interlaced 8-bit RGBA PNG. The script supports all PNG scanline
filters and uses every pixel with nonzero alpha, including translucent shadows.

The metadata records the smallest axis-aligned box around visible pixels in each
prop frame, standalone sprite and built-in tileset cell. The desk editor uses
these boxes for picking, selection outlines and placement limits, transforming
them around the same anchor as the artwork when rotated. Client and server share
the checked-in bounds; clients cannot supply their own smaller hitboxes. Unknown
custom artwork conservatively retains its full rectangle. Sprite images and
anchors are unchanged. These visible bounds are independent of physical collision.
Tests verify metadata against the finished artwork.

## Authored collision and render metadata

`assets/catalog.json` contains the big-item palette and intentional settings that
cannot be inferred from alpha. `width` and `height` are in 32px tiles. `solid`
defaults to false. For solid items, `collision` is a rectangle in world pixels
relative to the unrotated artwork's top-left; omitting it uses the full rectangle.
`collision: null` always means nonblocking. For example, the 32×64 Monstera uses
`{ "x": 8, "y": 46, "width": 16, "height": 16 }`: its pot blocks movement,
its leaves do not. Footprints rotate around the artwork's center and scale with
it. The editor's **Show collision footprints** toggle previews them in red.
Edit the catalog to author footprints; they are not inferred from visible bounds
and desk owners cannot override them. Unknown custom decor preserves its saved
`solid` flag and rectangular footprint.

`renderLayer` defaults to `furniture`; rugs use `ground`. Small props default to
`surface`. Items draw in that layer order, then by `renderOrder` (an integer from
−100 to 100, higher in front), then by Y. Both renderers and editor picking use
the same ordering. Players and zone labels remain above item layers.

Select an item in either editor to change its **Render layer** and **Priority
within layer**, including for a multi-selection. The item chooser can select a
rug even when other items cover it. Overrides persist as `renderLayer` and
`renderOrder` object properties; changing defaults in the catalog also applies
to existing objects without overrides. Personal edits still require desk ownership.

Structural collision remains a tile grid. Solid items use precise rotated boxes
against the avatar's 14×12 footprint, shared by server movement and client
prediction; small pots no longer block a whole tile.

## Map compatibility

`office-cozy.png` is the expanded starter tileset; `office-cozy@4x.png` has identical pixels at 4x. `office.png` and `office@4x.png` preserve the original eight tile IDs so existing persisted layouts get refreshed art without changing collision, positions or desk assignments. The renderer adds separate monitor sprites to those legacy desk tiles. Importing the new starter map adds its lounge, coffee corner, desk kits and surface metadata.

The 32px world grid and avatar collision footprint remain unchanged. Only floors, walls and the structural collision mask are tile layers. Rugs, desks, tables, seating, plants, lamps and other furniture are objects containing one or more atlas cells, so a multi-cell piece moves and rotates as one unit. Solid decor contributes its authored, transformed footprint to authoritative collision. The editor converts persisted expanded maps that still contain `rug` and `furniture` tile layers. Custom tilesets can omit a 4x sibling; the renderer falls back to the declared PNG.

Early expanded maps also named `office.png`, but declare 40 tiles in eight columns. The renderer resolves that combination to `office-cozy.png` (including its native-resolution fallback), preserving their saved tile IDs and layout without a database import.
