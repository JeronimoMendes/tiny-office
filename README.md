# Tiny Office

A small self-hosted, top-down virtual office. **Phase 2: audio/video.** React UI, Phaser pixel-art renderer, authoritative WebSockets, PostgreSQL persistence and a self-hosted LiveKit SFU. Architecture and phase gates: [PLAN.md](PLAN.md).

Implemented: phase-1 movement and space, editable availability, and zone-based calls. Walking into a desk or meeting room joins that zone's conversation; the open floor is silent. Focus blocks incoming media and video while still allowing an explicit unmute. DND is excluded from media entirely. Every media decision comes from the authoritative server position and status: each zone is its own SFU room, credentials name one room and last two minutes, and the server reconciles LiveKit membership and publish permissions, disconnecting anyone whose permissions exceed current policy. Moods, chat and screen sharing are not implemented.

## Start locally

Requires Docker with Compose:

```sh
cd tiny-office
docker compose up --build
```

Open **http://localhost:3000**. The app prints a **bootstrap secret** in its startup logs. Enter it with your email and display name to become the first owner. You can retrieve the logs with `docker compose logs app`. Once claimed, nobody can bootstrap another owner, including after a restart.

1. Open **Manage office** in the participants panel.
2. Enter a coworker's email and name and create a sign-in link.
3. Send that link privately to that person. It works **once** and expires after **24 hours**.
4. Assign their desk with the desk dropdowns. Each person can own one desk; anyone may enter it.
5. Use **WASD / arrow keys** to walk. Click your name in the bottom bar to edit your name and character. Collapse the people panel for more map space.

One active game connection per person/workspace. Opening another tab replaces the previous connection instead of creating a duplicate avatar. Separate people should use separate browser profiles, private windows or devices.

### Authentication model

There is no reusable shared account link, email sending, password or OAuth dependency. The owner controls distribution of person-specific credentials. Possession of the link authenticates the recipient; **the supplied email is an identifier, not an independently verified email address**. Enter the same email in Manage office to reissue a login link; this invalidates earlier unused links. Existing signed-in sessions remain valid for 30 days. Link secrets live in the URL fragment, are removed immediately on arrival, are never sent as URL query parameters, and are stored only as hashes. Sessions use HttpOnly, SameSite=Strict cookies (Secure when APP_ORIGIN uses HTTPS).

If the owner loses their session, an operator with access to Docker can issue a recovery link:

```sh
docker compose exec app npm run auth:owner-link
```

Anyone with server/DB administration access is already trusted. This recovery path is not exposed as an unauthenticated HTTP endpoint. Do not put personal links into public channels or screenshots.

### Configuration and deployment

Optional: copy `.env.example` to `.env`. Compose reads it; host-side Node commands require exported variables.

| Variable               | Default                                          | Purpose                                                                                                                           |
| ---------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`           | `http://localhost:3000`                          | Exact browser origin; HTTP mutations and WebSocket upgrades enforce it                                                            |
| `APP_PORT`             | `3000`                                           | Published host port; change APP_ORIGIN to match                                                                                   |
| `BIND_ADDRESS`         | `127.0.0.1`                                      | Local-only by default                                                                                                             |
| `POSTGRES_PASSWORD`    | `office`                                         | Local dev credential; change for deployment (use URL-safe characters, or override the Compose DB URL with a properly encoded URL) |
| `BOOTSTRAP_SECRET`     | random, printed once per unclaimed boot          | Optional fixed first-owner claim secret                                                                                           |
| `DATABASE_URL`         | `postgres://office:office@localhost:5432/office` | Host-side server/CLI database; Compose supplies its own DB URL                                                                    |
| `WORKSPACE_ID`         | `00000000-0000-4000-8000-000000000001`           | One process owns this workspace; UI exposes only that workspace                                                                   |
| `MAP_FILE`             | `maps/office.tmj`                                | Initial seed only; existing workspaces use the database revision                                                                  |
| `LIVEKIT_WS_URL`       | `ws://localhost:7880`                            | Browser-facing LiveKit signaling URL; use `wss://` with HTTPS                                                                     |
| `LIVEKIT_API_KEY`      | `devkey`                                         | LiveKit API key, shared by the app and the SFU; replace for deployment                                                            |
| `LIVEKIT_API_SECRET`   | `secret`                                         | LiveKit API secret; replace for deployment (32+ characters)                                                                       |
| `LIVEKIT_BIND_ADDRESS` | `127.0.0.1`                                      | Address publishing the LiveKit TCP/UDP ports                                                                                      |
| `LIVEKIT_NODE_IP`      | `127.0.0.1`                                      | Address LiveKit advertises to browsers; the public IP when deployed                                                               |

### Deploying media: HTTPS, UDP and TURN

Browsers only grant microphone and camera access on a secure origin, so any deployment beyond localhost needs HTTPS.

- Put a TLS reverse proxy in front of the app, forward `/ws` upgrades, and set `APP_ORIGIN` to the public `https://` origin.
- Terminate TLS for LiveKit signaling too and set `LIVEKIT_WS_URL` to that public `wss://` endpoint. A page served over HTTPS cannot open a plain `ws://` SFU connection.
- Replace `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`; the SFU reads the same pair through `LIVEKIT_KEYS`, so app and SFU stay in step. They are the only credential protecting room administration.
- Media itself is UDP. Publish `7882/udp` (and `7881/tcp` as a fallback) to the internet, set `LIVEKIT_BIND_ADDRESS=0.0.0.0`, set `LIVEKIT_NODE_IP` to the public address, or drop `--node-ip` from `compose.yaml` and set `use_external_ip: true` in [deploy/livekit.yaml](deploy/livekit.yaml).
- Clients behind firewalls that block outbound UDP need TURN. Uncomment the `turn` block in `deploy/livekit.yaml`, point it at a certificate for your domain, and publish `5349/tcp` (443 is the port most likely to be allowed) plus `3478/udp`.

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

## Edit the office in Tiled

Open **`maps/office.tmj`** in [Tiled](https://www.mapeditor.org/). No application code change is needed for a different layout.

Supported, intentionally small Tiled subset:

- Finite orthogonal maps, **32 × 32px tiles**, up to 256 × 256 tiles.
- One **embedded** tileset with first GID 1, 32px tiles, no spacing/margin, image at `../assets/<filename>.png`. Copy replacement images into `assets/`.
- Uncompressed numeric-array tile layer data. No infinite chunks, group layers, external `.tsx`, flipped tiles or layer offsets. Unsupported data is rejected rather than silently interpreted differently.
- Tile layers matching map dimensions. Visible tile layers render in file order, behind avatars.
- A tile layer named **`collision`**: any nonzero tile is solid. Hide this layer in Tiled. The server uses it regardless of visibility. Visible furniture does not automatically collide; paint its collision cells too.
- An object layer named **`zones`**, containing unrotated rectangles with custom string properties:
  - `zoneId`: stable unique ID, such as `desk-1` or `cedar`.
  - `kind`: `desk`, `meeting` or `open`.
  - Object name: visible zone label.
- An object layer named **`spawn`**, with its first object a point in a walkable location. The avatar's position is its foot center, with a 14 × 12px collision footprint.

Desk and meeting rectangles cannot overlap. Optional open-floor rectangles may cover them; specific call zones win. Outside all rectangles is also open floor. Membership uses foot-center containment, including top/left edges and excluding bottom/right edges. Players do not collide with one another.

The starter office has two meeting rooms and eight assignable desks. Expand it in Tiled to provide more personal desks; the simulation does not impose an eight-person limit.

### Import an edited map

Editing the file does **not** overwrite your database on startup. Import deliberately while the app is stopped:

```sh
docker compose stop app
docker compose run --rm app npm run map:import -- maps/office.tmj
docker compose up -d app
```

`maps/` and `assets/` are bind-mounted read-only, so map/art editing needs no image rebuild. The importer refuses to run if an authoritative server still owns that workspace. A valid import creates a new DB revision. Existing stable desk IDs retain assignments; removing/changing a desk zone removes its assignment. Invalid imports leave the active map untouched. Old revisions remain in the database. Clients reconnect with a full snapshot of the new map.

To regenerate the **original placeholder** art and starter map (overwrites `maps/office.tmj`):

```sh
python3 tools/generate-assets.py
```

No third-party artwork is included. Generated artwork is CC0; see [assets/LICENSE.md](assets/LICENSE.md). Placeholder art is the only intentionally disposable component.

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

### Code map

- `apps/server/src/world/tick.ts`: complete authoritative tick loop and workspace lifecycle. No simulation event bus or per-system dispatch.
- `packages/shared/src/`: message validation, fixed-step movement/collision and map/zone rules.
- `apps/server/src/persistence/`: SQL, batched position writer, auth/map persistence.
- `apps/server/src/transport/`: session-authorized HTTP and WebSocket handlers.
- `apps/client/src/session/`: networking, prediction/reconciliation and the typed renderer bridge.
- `apps/client/src/game/`: Phaser renderer, animation, keyboard input and interpolation.
- `apps/client/src/ui/`: React controls and styles.

Inputs contain only sequence and cardinal direction. Each server tick applies the newest input sample for at most one movement step per person; older queued samples are acknowledged and discarded to avoid clock-drift backlog. Queue/sequence bounds prevent speed hacks. The client predicts the same fixed steps and replays only unacknowledged inputs after correction. Remote positions use roughly 100ms interpolation. Changed player records are broadcast within the workspace; tiny tick/ack envelopes still go to each client. Region interest filtering belongs at the marked broadcast point when measurements justify it.

React and Phaser never read each other's state: `RendererBridge` carries copied snapshots out and directional commands in. Phaser owns its display objects; the session controller owns networking and prediction.

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

Coverage: 26 unit tests, 9 PostgreSQL/real-WebSocket integration tests and 1 two-browser end-to-end test. These cover zone boundaries and map validation, movement authority/input abuse, serialized/debounced persistence including failure retries, single-use link redemption, role/workspace/origin authorization, profile/desks and empty-server restoration, and 30 simultaneous socket clients. For media they cover the policy decisions themselves, SFU reconciliation against a fake room service, zone-scoped credential contents over real HTTP/WebSockets, revocation on focus/DND/zone changes, and two browsers actually exchanging audio and video through the SFU using Chromium's fake devices. The 30-client check is a local functional smoke test, not a WAN latency benchmark. There are no renderer unit tests or screenshot assertions.

## How calls work

- **Your current zone determines your conversation.** Each desk or meeting zone is its own SFU room, shared by its occupants. A person belongs to at most one conversation at a time; moving zones switches rooms.
- Desk owners are **never summoned remotely**. They participate only when physically inside that desk zone, just like anyone else.
- Meeting rooms have no distance falloff. Open floor stays silent, with no proximity chat.
- Focus joins muted by default, suppresses incoming audio and disables video. Users may explicitly unmute their microphone while staying focused; incoming audio and video remain disabled.

DND's absolute media restriction is enforced at the SFU, not by muting UI controls: a DND member is refused a credential and removed from the room, so no media is negotiated at all. Nothing published in a zone is reachable from outside it, because the credential names a single room and browsers never receive one for another zone. Screen sharing is deferred unless explicitly added to scope.
