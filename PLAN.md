# Virtual office — implementation plan

## Priorities and phase gates

Simple core, maintainability, then scale. Finish and verify each phase end to end before starting the next. Target 20–30 users per workspace and a 15 Hz authoritative simulation. No distributed simulation, plugins, feature flags, Redis, or generic event bus.

1. **Movement and space (complete):** owner bootstrap and owner-distributed personal login links; persistent Tiled map, desks and zones; authoritative movement, local prediction/reconciliation and remote interpolation; editable profile; restart/rejoin restoration; Docker Compose, README and expensive-path tests.
2. **Audio/video:** self-hosted LiveKit SFU, strictly zone-based calls, server-enforced media permissions and revocation. Validate multi-browser calls before proceeding.
3. **Presence:** free/focus/DND controls and visible indicators, cosmetic moods. Status is persisted from phase 1; media enforcement belongs in phase 2, not phase 3.
4. **Chat:** persisted workspace and direct messages with authorization. No chat machinery in the movement loop.

## Stack

- React + TypeScript + Vite for the interface.
- Phaser for the top-down pixel-art map, sprites, input and camera.
- Node.js + TypeScript, Fastify and ws for HTTP and authoritative WebSockets.
- PostgreSQL using pg and SQL migrations; no ORM.
- Self-hosted LiveKit added only in phase 2. HTTPS, UDP and TURN must be documented and tested for deployment.
- Docker Compose for one-command local startup, without cloud services.

## Boundaries

`apps/client/src/session`: owns WebSocket/client state and a typed renderer bridge.
`apps/client/src/game`: Phaser scene, input, local prediction visualization, remote interpolation.
`apps/client/src/ui`: React chrome, account controls, owner member/desk management.
`apps/server/src/world/tick.ts`: one readable loop: consume input → resolve positions/collision → compute zones → mark dirty → broadcast changes.
`apps/server/src/auth`: bootstrap, single-use personal links, hashed sessions.
`apps/server/src/persistence`: migrations, map import, queries and batched saves.
`apps/server/src/transport`: HTTP and WebSocket validation.
`packages/shared/src`: protocol, deterministic movement/collision and zone geometry.
`maps`, `assets`: editable map and original placeholder graphics.

React and Phaser use commands/events through one typed bridge; no shared mutable state between frameworks. A client session controller owns networking. There is one in-memory simulation per workspace ID, loaded even when nobody is online. Initially only the default workspace is exposed. Future workspace sharding routes a workspace ID to one process. Interest management goes at the broadcast recipient selection point; initially send changed players to everyone in that workspace.

## Data model

- workspaces: ID, name, active map revision.
- workspace_maps: workspace ID, revision/content hash, validated Tiled JSON.
- users: ID, email, display name, character.
- memberships: workspace ID + user ID, owner/member role, last position, status.
- desk_assignments: workspace ID + stable zone ID, owner user ID.
- login_tokens and sessions: hashed random secrets, workspace/user IDs, expiry and redemption/revocation.
- Invitations are owner-issued, single-use personal login tokens that establish a membership. They are not reusable shared account credentials.
- Phase 4 adds messages with workspace ID and optional recipient ID.

Map files use orthogonal, finite 32px Tiled JSON maps, a collision tile layer, rectangular zone objects with stable zoneId/kind properties, and a spawn object. Call zones may not overlap; open floor is the fallback. Geometry comes from the map; desk assignments refer to stable zone IDs. Explicit map import creates a durable revision; startup never overwrites an existing map. Invalid restored positions fall back to spawn.

Per-tick positions live in memory. Dirty records flush in batches about every two seconds and on disconnect/shutdown. An abrupt crash may lose about two seconds of movement. Persisted members survive disconnect; online presence does not. Keep pending dirty state on failed writes and avoid stale concurrent flushes.

## Protocol and authority

Versioned, runtime-validated JSON over same-origin authenticated WebSockets.

- Client: `input { seq, direction }` with cardinal direction or idle. No coordinates or client-supplied simulation duration.
- Server: `welcome { selfId, mapRevision, tick, players, ... }`; `delta { tick, ack, changedPlayers, removedPlayerIds }`; structured errors.
- Inputs are bounded and sequenced. At the fixed 15 Hz server rate, the newest sample determines one movement step; obsolete queued samples are coalesced/acknowledged rather than accumulating clock-drift latency. Shared fixed-step collision rules support client prediction and replay after acknowledgements.
- Remote players render from a short interpolation buffer.
- Full snapshot on join; changes thereafter. Workspace membership is authorized server-side.
- Future status/chat messages are separate commands. Media policies derive only from authoritative positions/zones and server-owned status.

## Media seam and confirmed phase 2 policy

Proposed transport: one SFU room per workspace with server-managed per-participant publish/subscribe permissions. An SFU room is a transport container, not permission to hear every workspace conversation. Clients cannot subscribe around server policy.

Confirmed by the user:

1. **Your current zone determines your conversation.** Server-computed zone membership selects at most one active conversation group, which may contain many people. Changing zones leaves the previous conversation; conversations never overlap for a person.
2. **No remote desk-owner summoning.** Desk occupants share that zone's conversation. The owner participates only while physically inside the same zone; an absent or offline owner is not connected. Desk ownership does not override zone membership.
3. **Strictly zone-based audio.** Everyone in a meeting room shares its conversation regardless of distance. Open floor is silent, with no proximity chat.
4. **Focus permits explicit microphone unmuting without switching to free.** Focus joins the zone conversation muted by default, suppresses incoming audio, and disables video. Manual unmuting does not enable incoming audio or video.
5. **DND excludes all media.** A DND user publishes and receives nothing, gets no SFU credential/connection, and negotiates no media stream. Entering DND forcibly removes existing media access. The avatar and status indicator remain visible.

These rules must be enforced by the server and SFU, not just by UI controls. Phase 2 must test conversation isolation, zone transitions, focus overrides, DND exclusion and permission revocation.

## Phase 1 working decisions

The user approved starting implementation without separately answering the architecture questions. Use the proposal's recommended phase-1 defaults and make them explicit:

- First owner claims the workspace with a one-time bootstrap secret printed by the server, not simply by arriving first.
- Owner distributes person-specific, single-use, expiring login links. Subsequent login links are reissued by the owner. No SMTP/OAuth dependency. This verifies possession of the owner-issued link, not ownership of the supplied email address.
- One active game connection per member per workspace; a new connection replaces the previous one.
- Non-overlapping rectangular desk/meeting zones, with open-floor fallback.
- Screen sharing is deferred pending explicit scope approval.
- Generated placeholder art is intentionally replaceable; no other planned throwaway components.

## Verification

Unit tests: collision/speed bounds, zone boundaries and map validation, input sequencing/backpressure.
Database integration tests: map import persistence, atomic token redemption, membership authorization, dirty saves/disconnect/restart restoration.
Browser end-to-end smoke test: bootstrap, owner invite, two independently authenticated players, movement and remote updates, session replacement/rejoin and saved position. No renderer unit or screenshot assertion tests.
Phase 2 adds media permission decision tests and integration tests proving revocation and DND exclusion; do not build speculative media code in phase 1.

## Phase 1 verification receipt

- 18 unit tests pass: map/zone boundaries, collision, authority, coalescing/input abuse, session replacement, reconnect directory and position writer retries/concurrency.
- 8 PostgreSQL/real-WebSocket integration tests pass, including 30 concurrent authenticated players, role/origin/session enforcement, single-use links, map revisions and restart restoration.
- 1 two-browser Playwright end-to-end test passes: owner bootstrap, private link distribution, profile/desks, movement, server zone transitions, reconnect and duplicate-session replacement.
- Typecheck, formatting check, production build, Docker build/Compose startup and npm audit pass (zero reported vulnerabilities).
- Additional operational checks pass: a live map import is blocked, an actual app-container restart preserves all durable state, and stopped-map import preserves accounts/positions/status/desks.
- Manually inspected the rendered office. No renderer tests were added.
- Remaining limits: the starter map has eight desks (editable in Tiled); the 30-client check is a local functional smoke test, not a WAN latency/load benchmark. Severe jitter may slow movement because the server never invents missing input steps. Phaser accounts for most of the roughly 1.5 MB minified client bundle; code splitting is deferred.

Phase 2 has not started; the conversation and focus policy questions are now resolved above.

## Acceptance for phase 1

`docker compose up --build` serves the app and durable database; README explains setup, owner bootstrap, link distribution, map editing/import and restart semantics. Two browser sessions can walk around the same map with collisions, server zones, animation and name labels; desks are owner-assignable; character and display name changes persist. State survives an empty workspace and server restart. Typecheck, build, unit, database and browser checks pass (or unavailable checks are explicitly reported).
