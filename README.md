# Tiny Office

A small self-hosted, top-down virtual office. **Phase 2: audio/video.** React UI, Phaser pixel-art renderer, authoritative WebSockets, PostgreSQL persistence and a self-hosted LiveKit SFU. Architecture and phase gates: [PLAN.md](PLAN.md).

Implemented: phase-1 movement and space, editable availability, and zone-based calls. Walking into a desk or meeting room joins that zone's conversation; the open floor is silent. Focus receives the zone conversation while keeping the local microphone and camera off until explicitly enabled. DND is excluded from media entirely. Every media decision comes from the authoritative server position and status: each zone is its own SFU room, credentials name one room and last two minutes, and the server reconciles LiveKit membership and publish permissions, disconnecting anyone whose permissions exceed current policy. Calls support explicit screen sharing alongside the camera, with a local preview and labeled remote screen tiles. Moods and chat are not implemented.

## Start locally

Requires Docker with Compose:

```sh
cd tiny-office
docker compose up --build
```

Open **http://localhost:3000**. The app prints a **bootstrap secret** in its startup logs. Enter it with your email and display name to become the first owner. You can retrieve the logs with `docker compose logs app`. Once claimed, nobody can bootstrap another owner, including after a restart.

1. Open **Manage office** in the participants panel.
2. Enter a coworker's email and name and create a sign-in link.
3. Send that link privately to that person. It works **once** and expires after **24 hours**. With `SMTP_URL` and `MAIL_FROM` set it is emailed for you, and anyone who loses their session can request a fresh one from the entry screen instead of asking you.
4. Members can claim an available desk by walking into its highlighted zone and accepting the prompt. Their “Pick a desk” to-do disappears once they have one, and the participants panel names their desk with a **Leave desk** button that hands it back to the office so they can walk into another one. The owner can still swap or clear any assignment with the desk dropdowns; each person can own one desk and anyone may enter it.
5. Use **WASD / arrow keys** to walk. Click your name in the bottom bar to edit your name and character. Mix head shapes, full-body skin tones, hairstyles, shirts, pants and shoes, with independent hair/clothing colors and a four-direction preview; save to update your character for everyone. Collapse the people panel for more map space.
6. Walk to the whiteboard at the top of a meeting room and press **Space** to start a shared tldraw canvas. Everyone in that room sees a live preview and can click it to draw with you. The board lasts until its final editor closes it or leaves the room.

One active game connection per person/workspace. Opening another tab replaces the previous connection instead of creating a duplicate avatar. Separate people should use separate browser profiles, private windows or devices.

### Authentication model

There is no reusable shared account link, password or OAuth dependency. Possession of the link authenticates the recipient; **the supplied email is an identifier, and is only a verified address when email delivery is configured**. Enter the same email in Manage office to reissue a login link; this invalidates earlier unused links. Existing signed-in sessions remain valid for 30 days.

Set `SMTP_URL` and `MAIL_FROM` to let people sign themselves back in: the entry screen then offers **Email me a sign-in link**, and owner-issued invites are mailed as well as shown for copying. The reply is identical for members and strangers, so the form cannot be used to discover who belongs to the office. A member gets at most one self-service link per minute, and a link issued this way is _added_ rather than swapped in, so somebody submitting a colleague's address cannot invalidate the link that colleague is about to use. Without both variables the form is hidden and members depend on the owner, as before. An `SMTP_URL` the server cannot parse is reported at startup and leaves email sign-in off rather than stopping the office, and an SMTP server that refuses the boot-time connection check is logged the same way. Link secrets live in the URL fragment, are removed immediately on arrival, are never sent as URL query parameters, and are stored only as hashes. Sessions use HttpOnly, SameSite=Strict cookies (Secure when APP_ORIGIN uses HTTPS).

The owner is a member like any other, so with email configured they recover from the entry screen too. Failing that (no SMTP, or mail is down), an operator with access to Docker can issue a recovery link:

```sh
docker compose exec app npm run auth:owner-link
```

Anyone with server/DB administration access is already trusted. This recovery path is not exposed as an unauthenticated HTTP endpoint. Do not put personal links into public channels or screenshots.

### Configuration and deployment

Optional: copy `.env.example` to `.env`. Compose reads it; host-side Node commands require exported variables.

| Variable               | Default                                          | Purpose                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`           | `http://localhost:3000`                          | Exact browser origin; HTTP mutations and WebSocket upgrades enforce it                                                                                                                                                                                                                    |
| `APP_PORT`             | `3000`                                           | Published host port; change APP_ORIGIN to match                                                                                                                                                                                                                                           |
| `BIND_ADDRESS`         | `127.0.0.1`                                      | Local-only by default                                                                                                                                                                                                                                                                     |
| `VITE_PORT`            | `5173`                                           | Published host port for the development client                                                                                                                                                                                                                                            |
| `DB_PORT`              | `5432`                                           | Published host port for PostgreSQL; the development overlay publishes it, the default stack does not                                                                                                                                                                                      |
| `COMPOSE_PROJECT_NAME` | directory name                                   | Names this stack's containers and its database volume; give a second checkout its own                                                                                                                                                                                                     |
| `POSTGRES_PASSWORD`    | `office`                                         | Local dev credential; change for deployment (use URL-safe characters, or override the Compose DB URL with a properly encoded URL)                                                                                                                                                         |
| `BOOTSTRAP_SECRET`     | random, printed once per unclaimed boot          | Optional fixed first-owner claim secret                                                                                                                                                                                                                                                   |
| `SMTP_URL`             | unset                                            | SMTP server for sign-in links; self-service sign-in is off unless set with `MAIL_FROM`. `smtps://user:pass@host:465` for implicit TLS, or `smtp://user:pass@host:587?requireTLS=true` for enforced STARTTLS. Percent-encode credentials: a login that is an email address contains an `@` |
| `MAIL_FROM`            | unset                                            | From address on sign-in emails, e.g. `Tiny Office <office@example.com>`                                                                                                                                                                                                                   |
| `DATABASE_URL`         | `postgres://office:office@localhost:5432/office` | Host-side server/CLI database; Compose supplies its own DB URL                                                                                                                                                                                                                            |
| `WORKSPACE_ID`         | `00000000-0000-4000-8000-000000000001`           | One process owns this workspace; UI exposes only that workspace                                                                                                                                                                                                                           |
| `MAP_FILE`             | `maps/office.tmj`                                | Initial seed only; existing workspaces use the database revision                                                                                                                                                                                                                          |
| `LIVEKIT_WS_URL`       | `ws://localhost:7880`                            | Browser-facing LiveKit signaling URL; use `wss://` with HTTPS                                                                                                                                                                                                                             |
| `LIVEKIT_API_KEY`      | `devkey`                                         | LiveKit API key, shared by the app and the SFU; replace for deployment                                                                                                                                                                                                                    |
| `LIVEKIT_API_SECRET`   | `secret`                                         | LiveKit API secret; replace for deployment (32+ characters)                                                                                                                                                                                                                               |
| `LIVEKIT_PORT`         | `7880`                                           | LiveKit signaling port. Clients dial the media ports directly, so LiveKit listens on the same numbers the host publishes                                                                                                                                                                  |
| `LIVEKIT_TCP_PORT`     | `7881`                                           | LiveKit RTC port for clients that cannot use UDP                                                                                                                                                                                                                                          |
| `LIVEKIT_UDP_PORT`     | `7882`                                           | LiveKit RTC media port                                                                                                                                                                                                                                                                    |
| `LIVEKIT_BIND_ADDRESS` | `127.0.0.1`                                      | Address publishing the LiveKit TCP/UDP ports                                                                                                                                                                                                                                              |
| `LIVEKIT_NODE_IP`      | `127.0.0.1`                                      | Address LiveKit advertises to browsers; the public IP when deployed                                                                                                                                                                                                                       |

### Deploying media: HTTPS, UDP and TURN

Browsers only grant microphone, camera and screen capture access on a secure origin, so any deployment beyond localhost needs HTTPS.

- Put a TLS reverse proxy in front of the app, forward `/ws` upgrades, and set `APP_ORIGIN` to the public `https://` origin.
- Terminate TLS for LiveKit signaling too and set `LIVEKIT_WS_URL` to that public `wss://` endpoint. A page served over HTTPS cannot open a plain `ws://` SFU connection.
- Replace `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`; the SFU reads the same pair (through `LIVEKIT_KEYS` in `compose.yaml`, through the config body on Coolify), so app and SFU stay in step. They are the only credential protecting room administration.
- Media itself is UDP. Publish `7882/udp` (and `7881/tcp` as a fallback) to the internet, set `LIVEKIT_BIND_ADDRESS=0.0.0.0`, set `LIVEKIT_NODE_IP` to the public address, or drop `--node-ip` from `compose.yaml` and set `use_external_ip: true` in [deploy/livekit.yaml](deploy/livekit.yaml).
- Clients behind firewalls that block outbound UDP need TURN. Uncomment the `turn` block in `deploy/livekit.yaml`, point it at a certificate for your domain, and publish `5349/tcp` (443 is the port most likely to be allowed) plus `3478/udp`.

### Deploying on Coolify

[compose.coolify.yaml](compose.coolify.yaml) is the same three services wired for Coolify's proxy: no host port for the app, LiveKit signaling proxied instead of published, and RTC ports on the host. Maps and assets come from the image, so a map change is a redeploy.

1. **New resource → Docker Compose**, pointing at this repository (branch `main`). Set the compose path to `compose.coolify.yaml`.
2. Set the environment variables Coolify lists from the file. `POSTGRES_PASSWORD` needs URL-safe characters (it is interpolated into `DATABASE_URL`), and `LIVEKIT_API_SECRET` needs 32+ characters:

   ```
   APP_ORIGIN=https://office.example.com
   LIVEKIT_WS_URL=wss://livekit.example.com
   POSTGRES_PASSWORD=<generated, URL-safe>
   LIVEKIT_API_KEY=<generated>
   LIVEKIT_API_SECRET=<generated, 32+ chars>
   ```

3. Give both services a domain: `https://office.example.com` on `app` (port 3000) and `https://livekit.example.com` on `livekit` (port 7880). They must match `APP_ORIGIN` and `LIVEKIT_WS_URL` exactly, host for host. Coolify issues the certificates and its proxy passes WebSocket upgrades through, so `/ws` and LiveKit signaling need no extra configuration.
4. Open `7881/tcp` and `7882/udp` on the server firewall and any cloud security group. The proxy does not carry media; LiveKit publishes these itself and discovers the public address through `use_external_ip` in the `LIVEKIT_CONFIG` block of [compose.coolify.yaml](compose.coolify.yaml). The config travels in the compose file rather than a bind mount because Coolify runs the stack outside the repository clone, where a mounted path resolves to an empty directory Docker creates, which LiveKit reports as `read /etc/livekit/livekit.yaml: is a directory`.
5. Deploy, then read the app logs for the bootstrap secret and claim ownership at `APP_ORIGIN`. Leave `BOOTSTRAP_SECRET` unset to get a fresh one per unclaimed boot.

Coolify's terminal on the `app` service runs the operator commands: `npm run auth:owner-link` for owner recovery, `npm run map:import -- maps/office.tmj` after a map change. The `office-data` volume survives redeploys; deleting the resource with volumes deletes the office and accounts.

On Linux hosts, raise the UDP buffers LiveKit asks for at startup (`net.core.rmem_max`/`wmem_max` of about 5 MB); the default is too small for several concurrent calls.

Verify each path from a network you do not control: a call between two networks confirms UDP, and LiveKit's [connection tester](https://livekit.io/connection-test) reports whether it fell back to TURN. Do not expose PostgreSQL.

The Compose app runs as a non-root user. The image intentionally retains source/dev tools for map import, owner recovery and the small project's test workflow; a split production-only image can be added when deployment size matters.

## Persistence

`office-data` is a named PostgreSQL volume. `docker compose down` preserves it; **`docker compose down -v` deletes the office and accounts**.

- Map definitions are stored as validated, content-addressed Tiled revisions in PostgreSQL.
- Accounts, memberships, character/name, status and desk assignments are durable.
- Live positions stay in memory. Dirty positions are coalesced and batch-flushed every two seconds, on disconnect and on graceful shutdown. Failed batches remain dirty and are retried.
- A crash may lose about two seconds of movement, not the office. A database outage can extend that window; failed writes are logged.
- An empty workspace remains loaded, with all members' saved positions intact. Online presence is intentionally not durable.
- A blocked/out-of-bounds saved position is repaired to the map's spawn, then saved.
- A PostgreSQL advisory lock prevents accidentally running two authoritative processes for the same workspace. It is a guard, not a distributed simulation. Loss of its dedicated DB connection terminates the process to prevent split authority.

Back up the DB, plus your `maps/` and `assets/` sources. Example:

```sh
docker compose exec -T db pg_dump -U office office > office-backup.sql
```

## Edit the office

Workspace owners can open **Manage office → Edit workspace map** to use the built-in admin-only editor. Select the workspace, then paint, erase or move structural floor/wall tiles; edit the collision layer; drag, resize, add or remove desks and meeting rooms; and place objects either on the whole map or as items belonging to a specific desk. Selected spaces have eight on-map resize handles as well as exact width/height fields. Spaces can be copied and pasted with their enclosed furniture and small items (`Cmd/Ctrl+C` and `Cmd/Ctrl+V` work too). Enable **Multi-select objects** or hold Shift to build an object selection; dragging any selected object moves the entire group, and rotate/delete applies to the group. Rugs, desks, tables, chairs, plants, lamps and other decor are independent objects above the structural grid. Multi-tile furniture moves and rotates as one object. Moving a desk or room space carries every decor object and small item whose center is inside that space; moving one furniture object never pulls nearby items along with it. Legacy tile-based furniture is converted to objects when its map is first opened in the editor. Changes remain a local draft until **Save workspace** is pressed.

Saving creates a validated map revision and reloads connected clients. Existing people and desk assignments are retained by stable desk IDs. Saved positions are retained when they remain walkable; a person is moved to spawn only when the edited map makes their old position invalid. Concurrent edits are rejected instead of overwriting a newer revision. Only the workspace owner can read or save through the editor API.

For source-controlled maps or more advanced editing, open **`maps/office.tmj`** in [Tiled](https://www.mapeditor.org/). No application code change is needed for a different layout.

Supported, intentionally small Tiled subset:

- Finite orthogonal maps, **32 × 32px tiles**, up to 256 × 256 tiles.
- One **embedded** tileset with first GID 1, 32px tiles, no spacing/margin, image at `../assets/<filename>.png`. Copy replacement images into `assets/`. The client prefers a supersampled sibling — `office.png` in the map means `office@4x.png` on screen — using nearest-neighbor sampling to keep the original 32px pixel grid crisp.
- Uncompressed numeric-array tile layer data. No infinite chunks, group layers, external `.tsx`, flipped tiles or layer offsets. Unsupported data is rejected rather than silently interpreted differently.
- Tile layers matching map dimensions. Visible tile layers render in file order, behind avatars.
- A tile layer named **`collision`**: any nonzero tile is solid. Hide this layer in Tiled. The server uses it regardless of visibility. Visible furniture does not automatically collide; paint its collision cells too.
- An object layer named **`zones`**, containing unrotated rectangles with custom string properties:
  - `zoneId`: stable unique ID, such as `desk-1` or `cedar`.
  - `kind`: `desk`, `meeting` or `open`.
  - Object name: visible zone label.
- An optional object layer named **`props`**: points with a string property `prop` naming an entry in `assets/props.json`, drawn on top of the tiles at that exact spot. Desk clutter lives here rather than in the tileset, so a desk can be dressed without redrawing a tile.
- An object layer named **`spawn`**, with its first object a point in a walkable location. The avatar's position is its foot center, with a 14 × 12px collision footprint.

Desk and meeting rectangles cannot overlap. Optional open-floor rectangles may cover them; specific call zones win. Outside all rectangles is also open floor. Membership uses foot-center containment, including top/left edges and excluding bottom/right edges. Players do not collide with one another.

The starter office has two meeting rooms and eight assignable desks. Unassigned desks are highlighted and labeled available in the map. Expand it in Tiled to provide more personal desks; the simulation does not impose an eight-person limit.

### Import an edited map

Editing the file does **not** overwrite your database on startup. Import deliberately while the app is stopped:

```sh
docker compose stop app
docker compose run --rm app npm run map:import -- maps/office.tmj
docker compose up -d app
```

`maps/` and `assets/` are bind-mounted read-only, so map/art editing needs no image rebuild. The importer refuses to run if an authoritative server still owns that workspace. A valid import creates a new DB revision. Existing stable desk IDs retain assignments; removing/changing a desk zone removes its assignment. Invalid imports leave the active map untouched. Old revisions remain in the database. Clients reconnect with a full snapshot of the new map.

The pixel artwork in `assets/` is checked in, not generated: the sheets are the source. Draw new pieces as pixel art and edit the sheets directly. Existing eight-tile maps continue to use a compatible `office.png`; new maps use `office-cozy.png`.

The eight character presets have registered head, hair, clothing, shoe, accessory and hat layers. Desks have clean surfaces, with 19 separate prop sprites placed at pixel coordinates. Artwork conventions and the future customization path are in [assets/ART.md](assets/ART.md). The character editor composes independent layers in both the preview and the walking avatar. It offers four heads, six skin tones, nine hairstyles, eight shirts, six bottoms and four shoe styles, plus palette choices, accessories, hats and eight starter outfits. Choices persist in PostgreSQL and broadcast to the office; existing character numbers resolve to their starter outfits. Members can use **Edit desk** to personalize their assigned desk with small and big items; structural tiles and other desks remain protected. After editing artwork, run `npm run assets:bounds` to refresh the visible-pixel bounds used for item selection and desk placement. This post-processing command never changes the PNGs.

No third-party artwork is included. The artwork is CC0; see [assets/LICENSE.md](assets/LICENSE.md).

## Develop

The Compose override mounts `apps/` and `packages/` into the app container and replaces its command with the watch servers, so no host toolchain is needed:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up
```

Open http://localhost:5173. Client edits hot-reload through Vite; server edits restart `tsx watch`. `node_modules` comes from the image, so rebuild (`--build`) after changing a `package.json`. Port 3000 keeps serving the image's production build and is stale in this mode.

To run the servers on the host instead, with Node 22.12+ and npm:

```sh
npm ci
docker compose -f compose.yaml -f compose.dev.yaml up -d db livekit
DATABASE_URL=postgres://office:office@localhost:5432/office \
  APP_ORIGIN=http://localhost:5173 \
  LIVEKIT_URL=http://localhost:7880 LIVEKIT_WS_URL=ws://localhost:7880 \
  LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret npm run dev
```

Stop the Compose app first (`docker compose stop app`); only one server can own a workspace. Media needs the `livekit` service running, and the credentials above must match the ones it started with. The override also exposes PostgreSQL on loopback for host-side tooling. `npm run build && npm start` serves the production build from port 3000.

### Work on several branches at once

A branch gets an office of its own. [Worktrunk](https://worktrunk.dev) drives the git worktrees, and [.config/wt.toml](.config/wt.toml) tells it what a new one needs:

```sh
wt switch --create meeting-rooms
```

That copies `node_modules` across from the main checkout — [.worktreeinclude](.worktreeinclude) says what travels — and writes an `.env` handing the branch a Compose project of its own and a block of ten ports, hashed from the branch name so they stay put between sessions and stay clear of the other worktrees. Six are used, counting up from the base: the app, the development client, PostgreSQL, and LiveKit's three. `docker compose up --build` then raises a second office beside the first, database volume and all, and `wt list` shows each branch's URL, dimmed until it answers.

The project config also carries the aliases worth having:

| Command   | Runs                                             |
| --------- | ------------------------------------------------ |
| `wt up`   | `docker compose up --build`                      |
| `wt dev`  | the development overlay above                    |
| `wt down` | `docker compose down --volumes --remove-orphans` |

Extra flags pass through, so `wt dev -d` detaches. `wt merge` runs `format:check`, `typecheck` and the unit tests before it merges. `wt remove` takes the branch's containers and database down with it: the office a branch ran is disposable, so anything worth keeping should be committed first.

For a worktree made with plain `git worktree add`, do the same by hand:

```sh
tools/worktree-env.sh 12000 office_meeting_rooms ../tiny-office/.env > .env
```

Whatever the generated `.env` does not define — SMTP credentials, LiveKit keys — is carried over from the checkout the branch came from. Compose reads the file itself; host-side commands need it exported, with `set -a; . ./.env; set +a`.

### Code map

- `apps/server/src/world/tick.ts`: complete authoritative tick loop and workspace lifecycle. No simulation event bus or per-system dispatch.
- `packages/shared/src/`: message validation, fixed-step movement/collision and map/zone rules.
- `apps/server/src/persistence/`: SQL, batched position writer, auth/map persistence.
- `apps/server/src/transport/`: session-authorized HTTP and WebSocket handlers.
- `apps/client/src/session/`: networking, prediction/reconciliation and the typed renderer bridge.
- `apps/client/src/game/`: Phaser renderer, animation, keyboard input and interpolation.
- `apps/client/src/ui/`: React controls and styles.

Inputs contain only sequence and heading, one of the eight compass directions. Each server tick applies the newest input sample for at most one movement step per person; diagonals cover the same distance as cardinals and slide along a wall when only one axis is blocked; older queued samples are acknowledged and discarded to avoid clock-drift backlog. Queue/sequence bounds prevent speed hacks. The client predicts the same fixed steps and replays only unacknowledged inputs after correction. Local presentation integrates the same collision rules at display rate, responding to heading changes on the next frame rather than easing toward 15 Hz position jumps. Only prediction errors are smoothed; a sub-tick presentation offset (at most 8px) is held at rest and absorbed when walking resumes, preventing a backward slide on release without changing authoritative positions or zones. Speculation is bounded during network stalls. Remote positions use roughly 100ms interpolation. Changed player records are broadcast within the workspace; tiny tick/ack envelopes still go to each client. Region interest filtering belongs at the marked broadcast point when measurements justify it.

React and Phaser never read each other's state: `RendererBridge` carries copied snapshots out and heading commands in, with a lightweight local-motion read each frame (no per-frame world cloning or React updates). Phaser owns its display objects; the session controller owns networking and prediction.

## Test

```sh
npm run typecheck
npm test
npm run build
npm audit
```

Database integration tests create/drop their **own temporary schema**, without clearing your workspace. Via Docker (root is only needed for Vite's test cache in the otherwise read-only app image):

```sh
docker compose build
docker compose run --rm --user root \
  -e TEST_DATABASE_URL=postgres://office:office@db:5432/office \
  app npm run test:integration
```

Or host-side with the dev DB port exposed:

```sh
TEST_DATABASE_URL=postgres://office:office@localhost:5432/office npm run test:integration
```

Browser end-to-end smoke test uses a **separate empty office**. It claims that office, so do not point it at your real workspace:

```sh
APP_PORT=3010 APP_ORIGIN=http://localhost:3010 BOOTSTRAP_SECRET=office-e2e-secret \
  docker compose -p office-e2e up -d --build
npx playwright install chromium
E2E_ALLOW_BOOTSTRAP=1 npm run test:e2e
# Remove only the disposable test office when finished:
docker compose -p office-e2e down -v
```

Coverage: 81 unit tests, 10 PostgreSQL/real-WebSocket integration tests and 1 two-browser end-to-end test. These cover zone boundaries and map validation, movement authority/input abuse, serialized/debounced persistence including failure retries, single-use link redemption, role/workspace/origin authorization, profile/desks and empty-server restoration, and 30 simultaneous socket clients. For media they cover the policy decisions themselves, SFU reconciliation against a fake room service, zone-scoped credential contents over real HTTP/WebSockets, revocation on focus/DND/zone changes, and two browsers actually exchanging audio and video through the SFU using Chromium's fake devices. The 30-client check is a local functional smoke test, not a WAN latency benchmark. The isolated `tests/e2e/art.spec.ts` browser fixture loads the artwork, checks movement, preset choices, mixed wardrobes, save/reload, failed saves and cancellation, and writes office/wardrobe screenshots without a database or SFU. It also checks compatibility with the original eight-tile map, native tileset fallback, exact character-layer compositing, rendered walking-speed consistency, and no positional drift after key release. Local movement unit tests cover 30–144 Hz displays, five-second walks stopped at different tick phases, acknowledgement replay, corrections, stalls, collisions, and reconnects. There are no screenshot baseline assertions.

## How calls work

Use **Share screen** during a zone call to choose a screen, window or tab. Sharing is video-only and never starts automatically; stop it with **Stop sharing** or the browser's sharing control. Camera and microphone controls remain independent. **Expand call** makes shared content easier to read without cropping it. Clicking a screen tile in the strip opens the expanded call on it; clicking one inside the expanded call pins it, giving the share the panel and dropping every camera into a strip beneath it. Clicking the pinned screen again returns the even grid. Leaving the conversation or entering DND stops capture. Screen sharing requires a browser supporting `getDisplayMedia` (typically desktop) and HTTPS or localhost.

- **Your current zone determines your conversation.** Each desk or meeting zone is its own SFU room, shared by its occupants. A person belongs to at most one conversation at a time; moving zones switches rooms.
- Desk owners are **never summoned remotely**. They participate only when physically inside that desk zone, just like anyone else.
- Meeting rooms have no distance falloff. Open floor stays silent, with no proximity chat.
- Available automatically enables microphone and camera when another person enters the zone. If the tab is hidden while the zone is empty, both stay on for a three-minute grace period and then turn off; they resume when somebody enters or the user returns to the tab. Media stays on while a conversation continues in a hidden tab.
- Focus receives audio and video from the zone but keeps the local microphone and camera off by default. Users may explicitly enable either while staying focused.

DND's absolute media restriction is enforced at the SFU, not by muting UI controls: a DND member is refused a credential and removed from the room, so no media is negotiated at all. Nothing published in a zone is reachable from outside it, because the credential names a single room and browsers never receive one for another zone. Screen sharing is deferred unless explicitly added to scope.
