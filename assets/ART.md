# Tiny Office artwork

Original pixel art with warm oak, sage walls, terracotta pots and slate upholstery. Characters use a 24 × 32 pixel canvas and a restrained palette. All artwork is authored in Python source; no external image service or Python packages are needed.

Run `python3 tools/generate-assets.py` to regenerate art. Add `--map` only when you want to overwrite the starter map. The database map is never changed by this command.

## Characters

`tools/art_avatars.py` draws each appearance from one wardrobe record. `assets/avatars.json` records the eight presets, dimensions, direction order, foot anchor, layer order and layer sheets. All sheets have the same registration: 12 columns (down, left, right, up; three gait frames each) and eight preset rows. The middle frame is idle. Coordinates are authored at 4x, snapped to 4px blocks, and rendered at 1/4 scale.

The flattened `avatars.png` serves both Phaser and the React character picker. `avatar-layers/` also exports hair behind the body, body, pants, shoes, shirt, hands, head, front hair, accessories and hats as transparent sheets. Those layers composite back to exactly the flattened sheet. Head shape, skin tone, hairstyle/color, shirt/style, pants/skirt, shoes, accessory and hat are separate generator inputs. Hands are separate from sleeves; a hat does not replace the chosen hairstyle.

For the future editor, introduce a versioned appearance record with stable part IDs and palette choices, resolving existing numeric character IDs to these presets. Generate all layers from that record so exposed skin and direction-dependent layering stay consistent. Keep the 24 × 32 registration and foot anchor across parts. A runtime compositor can synchronize one direction/gait frame across the layers and cache flattened textures by appearance. Validate selections on the server and persist the appearance alongside the member before exposing editing controls. Current network messages and saved character IDs remain compatible.

## Desks and props

`tools/art_tiles.py` draws empty desktops; drawer handles are on their front aprons. `tools/art_items.py` defines 18 independent transparent props and `props.json` supplies their frame IDs, scale and contact anchor. Props in the map's `props` object layer are positioned by their contact point in world pixels, sorted by that point's Y coordinate, and respect object/layer visibility. This permits off-grid placement and overlapping items without baking them into the desk image.

Each starter desk has a hidden `surfaces` rectangle with a stable `surfaceId` matching its desk zone ID. The rectangle covers only the desktop, not the chair, legs or surrounding call zone. Desk props reference that surface ID. These are authoring metadata, not editable state or new collision rules.

For a future desk editor, store `{ instanceId, surfaceId, itemId, x, y }` with `x/y` relative to the surface origin in world pixels. Do not snap to 32px map cells. Add per-item contact footprints and enforce those against the surface rectangle; taller artwork can extend above its contact area. Render contact points back in world coordinates and use their Y value for stacking. Authorize edits against the desk assignment, validate bounds server-side, persist and broadcast placements separately from the map revision. Removing an item should leave the clean desktop intact.

## Map compatibility

`office-cozy.png` is the expanded starter tileset; `office-cozy@4x.png` has identical pixels at 4x. `office.png` and `office@4x.png` preserve the original eight tile IDs so existing persisted layouts get refreshed art without changing collision, positions or desk assignments. The renderer adds separate monitor sprites to those legacy desk tiles. Importing the new starter map adds its lounge, coffee corner, desk kits and surface metadata.

The 32px world grid and avatar collision footprint remain unchanged. Tile art, desk surfaces and call zones have separate responsibilities. Custom tilesets can omit a 4x sibling; the renderer falls back to the declared PNG.

Early expanded maps also named `office.png`, but declare 40 tiles in eight columns. The renderer resolves that combination to `office-cozy.png` (including its native-resolution fallback), preserving their saved tile IDs and layout without a database import.
