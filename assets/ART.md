# Tiny Office artwork

Original pixel art with warm oak, sage walls, terracotta pots and slate upholstery. Characters use a 24 × 32 pixel canvas and a restrained palette. All artwork is authored in Python source; no external image service or Python packages are needed.

Run `python3 tools/generate-assets.py` to regenerate art. Add `--map` only when you want to overwrite the starter map. The database map is never changed by this command.

## Characters

`tools/art_avatars.py` draws each appearance from one wardrobe record. `assets/avatars.json` records the eight presets, dimensions, direction order, foot anchor, layer order and layer sheets. All sheets have the same registration: 12 columns (down, left, right, up; three gait frames each) and eight preset rows. The middle frame is idle. Coordinates are authored at 4x, snapped to 4px blocks, and rendered at 1/4 scale.

The flattened `avatars.png` and `avatar-layers/` remain the preset reference exports. Those layers composite back to exactly the flattened sheet. The editor and Phaser use `wardrobe/` instead: independent transparent atlases with native 24 × 32 frames, 12 columns, and one row per style/color combination. Front and back hair surround the other layers; hands are separate from sleeves, and sandals reveal feet from the body layer. Skin is drawn only in the body, hands and head layers, so it always matches across the whole character.

`packages/shared/src/wardrobe.json` is the shared, append-only option catalog. `appearance.ts` validates all indices, resolves old numeric characters to presets, and defines layer ordering and row registration for both renderers. `tools/generate-wardrobe.py` uses the same catalog to export all combinations. Run it alone to regenerate wardrobe art, or run `generate-assets.py` for all artwork. Keep its layer slot order synchronized with `appearanceLayers`; unit tests check atlas dimensions and row bounds.

Profiles save an optional `appearance` record alongside the legacy character number. A null record uses the original preset. Database migration 2 adds the JSONB column without changing existing profiles. Protocol version 3 carries the record in member and player updates, including reconnect snapshots. Part indices are stable: append new options, and migrate existing records if ever reordering or removing options.

## Desks and props

`tools/art_tiles.py` draws empty desktops; drawer handles are on their front aprons. `tools/art_items.py` defines 18 independent transparent props and `props.json` supplies their frame IDs, scale and contact anchor. Props in the map's `props` object layer are positioned by their contact point in world pixels, sorted by that point's Y coordinate, and respect object/layer visibility. This permits off-grid placement and overlapping items without baking them into the desk image.

Each starter desk has a hidden `surfaces` rectangle with a stable `surfaceId` matching its desk zone ID. The rectangle covers only the desktop, not the chair, legs or surrounding call zone. Desk props reference that surface ID. These are authoring metadata, not editable state or new collision rules.

The built-in owner editor places these props off-grid and can associate them with a stable desk ID. Props can be moved and rotated independently; moving a desk zone carries its associated small items. Removing an item leaves the clean desktop object intact.

## Map compatibility

`office-cozy.png` is the expanded starter tileset; `office-cozy@4x.png` has identical pixels at 4x. `office.png` and `office@4x.png` preserve the original eight tile IDs so existing persisted layouts get refreshed art without changing collision, positions or desk assignments. The renderer adds separate monitor sprites to those legacy desk tiles. Importing the new starter map adds its lounge, coffee corner, desk kits and surface metadata.

The 32px world grid and avatar collision footprint remain unchanged. Only floors, walls and the structural collision mask are tile layers. Rugs, desks, tables, seating, plants, lamps and other furniture are objects containing one or more atlas cells, so a multi-cell piece moves and rotates as one unit. Solid decor contributes its transformed footprint to authoritative collision. The editor converts persisted expanded maps that still contain `rug` and `furniture` tile layers. Custom tilesets can omit a 4x sibling; the renderer falls back to the declared PNG.

Early expanded maps also named `office.png`, but declare 40 tiles in eight columns. The renderer resolves that combination to `office-cozy.png` (including its native-resolution fallback), preserving their saved tile IDs and layout without a database import.
