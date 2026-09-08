# RFC 001: Collaborative agent participants

**Status:** Draft for discussion; not an implementation commitment.  
**Scope of this PR:** Architecture alternatives, interaction model, boundaries and staged acceptance gates. No runtime changes, new dependencies or required services.

## Goal

Make an agent a useful, visibly non-human coworker in the office: walk up to it, talk over voice, hear its reply, watch its computer-use session, and explicitly open a terminal attached to that same work session. This is not a scripted NPC or a chatbot painted onto an avatar.

Tiny-office should provide the **participation mechanism**, not define the intelligence. Operators should be able to change models, agent frameworks and skill sets without changing or rebuilding this repository. Personal digital twins, multiple specialists and dedicated bot rooms are future applications of that mechanism, not requirements for the first release.

### Proposed first experience

1. An owner registers one external agent and places it at a validated, stationary location in a designated meeting zone. Its avatar and participant entry have a permanent **Agent** badge, operator attribution and an honest online/offline state.
2. A member clicks the avatar or its accessible participant-list action. An agent card explains its purpose, capabilities, external processing/retention policy and current state. Clicking does not activate a microphone or execute a command.
3. The member enters the agent-enabled zone, acknowledges the disclosure, and explicitly chooses **Talk**. The agent listens and responds through the existing call UI. Other consenting occupants can collaborate; this is a shared room conversation, not a private chat with the person who clicked first.
4. In a later slice, **Watch session** requests an approved screen-share track from the agent's sandbox. The existing expanded/pinned screen UI displays it with the agent label.
5. In a later slice, **Open terminal** attaches to that same sandbox/session after an authorization check. It does not launch a shell on the tiny-office host and does not mean merely opening a text chat with the agent.
6. **Stop interaction** stops the shared agent interaction (with a clear room-wide effect); **Disconnect me** leaves only the member's interaction. An owner can disable the agent and revoke every attachment. Leaving the zone closes that member's watch/terminal access.

Proposed MVP defaults: one workspace-managed agent, one designated zone, one active shared interaction, voice first, no autonomous roaming, no recording or persistent conversation memory by default. These are recommendations to approve, not previously agreed product decisions.

## What exists today

The foundation is useful, but attaching an arbitrary LiveKit worker alone will not work:

| Existing seam                                                                                                                                                                               | Consequence for this feature                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`protocol.ts`](../../packages/shared/src/protocol.ts): protocol v5, `Player` presence, human `Member` with email and owner/member role                                                     | Add explicit agent identity and capabilities; do not fabricate human accounts or email addresses. Version the changed browser protocol.    |
| [`world/tick.ts`](../../apps/server/src/world/tick.ts): online players belong to cookie-authenticated human connections                                                                     | Separate participant presence from human input/session ownership without replacing the authoritative 15 Hz loop.                           |
| [`websocket.ts`](../../apps/server/src/transport/websocket.ts), [`http.ts`](../../apps/server/src/transport/http.ts): same-origin human sessions                                            | Give external connectors a separate, scoped machine-authenticated route; retain human origin/cookie checks unchanged.                      |
| [`policy.ts`](../../apps/server/src/media/policy.ts), [`livekit.ts`](../../apps/server/src/media/livekit.ts): one room per zone, two-minute JWTs, reconciliation removes unknown identities | Register agent presence with the authority and derive grants from it. An unregistered worker is correctly evicted today.                   |
| [`Media.tsx`](../../apps/client/src/ui/Media.tsx): remote audio/video and labeled screen tracks                                                                                             | Reuse the transport and screen presentation; synthetic speech and desktop frames originate outside tiny-office.                            |
| [`media-presence.ts`](../../apps/client/src/ui/media-presence.ts), [`main.tsx`](../../apps/client/src/main.tsx): peer presence can resume available users' devices                          | A bot appearing must not silently turn on human devices. Add a disclosure/consent gate, including entry into an already active agent room. |
| [`bridge.ts`](../../apps/client/src/session/bridge.ts), [`OfficeScene.ts`](../../apps/client/src/game/OfficeScene.ts): copied snapshots and typed commands                                  | Add agent selection through the bridge, not shared React/Phaser mutable state; offer equivalent keyboard-accessible UI.                    |
| [`001_initial.sql`](../../apps/server/src/persistence/001_initial.sql), [`store.ts`](../../apps/server/src/persistence/store.ts): human memberships, desks, login/session secrets           | Add agent registration separately; preserve human auth and existing desk foreign keys.                                                     |

Open floor remains silent; DND excludes media; focus receives with devices off by default. Agent participation must preserve these policies. Existing whiteboards and future persisted chat are independent features, not prerequisites.

## Three architecture alternatives

### A. LiveKit-native agent worker

```text
Human browser <--- voice / screen ---> LiveKit <---> external LiveKit agent worker
      |                                  ^                 |
      +-- tiny-office authority ---------+           models / skills / sandbox
          identity, zone, dispatch grants
```

Tiny-office registers agent participants and dispatches an external worker using LiveKit's agent ecosystem. Worker configuration selects models and skills outside this repo. Optional sandbox and terminal access are worker-side extensions.

**Pros**

- Shortest path to a voice prototype; existing voice tooling can supply turn detection, interruption and speech pipelines.
- Media travels directly through the SFU rather than through the game server.
- Keeps model credentials and tools out of the office process.

**Cons**

- The integration and lifecycle become coupled to LiveKit's worker/dispatch model, not just its media transport.
- A backend that does not speak that model needs a wrapper anyway.
- Shared computer sessions and terminal authorization still need a separate contract.
- Worker infrastructure/credential requirements need validation against the self-hosted deployment; do not hand workers the office SFU administrator secret by default.

**Best fit:** Prioritize a voice demonstration and accept framework-specific integration. Prototype self-hosted dispatch and least-privilege credentials before committing.

### B. Backend-neutral participant connector — recommended

```text
Human browser <-- office HTTP / WS --> tiny-office authority <-- outbound connector WS --+
      |                                  |                                            |
      +-------------- LiveKit -----------+------ voice / screen ------ external connector
                                                                            |
                                                                 chosen runtime / skills
                                                                            |
                                                                 isolated work session
Human browser <---- authorized terminal attachment --------------------------+
```

A small, versioned connector contract covers registration handshake, liveness, declared capabilities, interaction lifecycle and attachment grants. The connector runs beside the external agent runtime and initiates an authenticated connection to tiny-office. It translates the contract into whichever runtime is selected. It may itself use LiveKit Agents; tiny-office does not depend on that choice.

**Pros**

- The office stays a collaboration surface, not an agent framework or skill registry.
- Models, skills and runtimes can change independently, with a stable office identity.
- One coherent work-session identity can bind voice, desktop and terminal.
- An outbound connector connection avoids exposing arbitrary inbound worker endpoints to the office server.
- Fits the existing app/PostgreSQL/LiveKit stack; only agent users run an optional external connector/runtime.

**Cons**

- We must design and maintain a protocol, a conformance fixture and at least one external adapter.
- Liveness, reconnect fencing, capability changes and session revocation are real engineering work.
- Backend neutrality does not make speech latency or computer-use support uniform. A provider needs an adapter, not merely a different URL.
- Terminal access is a distinct security boundary even with a shared session ID.

**Best fit:** The requested long-term goal: bring your own useful agents, with interchangeable backends and externally managed skills.

**Constraint:** This is a narrow external protocol, not an in-process plugin loader, generic event bus, tool marketplace or orchestration engine. No model SDK, skill contents, tool execution or model inference in the authoritative tick.

### C. Remote-workstation participant

```text
Human browser <---- office presence + LiveKit ----> remote workstation participant
      +---------- authorized desktop / terminal --> isolated VM or container
                                                       |
                                              agent runtime + skills
```

Treat an externally managed workstation as the integration unit: an agent runtime, desktop capture, terminal and a participant sidecar live together. The workstation publishes its desktop and synthetic speech as office media and exposes a controlled session portal.

**Pros**

- Most direct model for computer-use collaboration: the human watches and attaches to the machine the agent is actually using.
- Can accommodate existing CLI agents and desktop tools without porting their skills.
- Clear execution boundary when each work session has a properly isolated machine.

**Cons**

- Highest operational cost: scheduling machines, desktop capture, PTYs, patching, idle cleanup and network isolation.
- Voice still needs a speech adapter; a desktop alone does not provide conversational behavior.
- Automating a full human browser login is brittle and would blur identity/authorization. Use a real machine participant sidecar, not a fake human account.
- Too much infrastructure if many agents need only conversation or APIs.

**Best fit:** Computer-use demonstrations are more important than a minimal voice MVP. Later, a workstation can sit behind B rather than becoming a separate office architecture.

### Comparison

Relative complexity includes the external component, not just code added here.

| Criterion                              | A: LiveKit-native       | B: Connector                         | C: Workstation                           |
| -------------------------------------- | ----------------------- | ------------------------------------ | ---------------------------------------- |
| First voice slice                      | Lowest effort           | Moderate effort                      | Highest effort                           |
| Swap agent framework                   | Worker-specific wrapper | Explicit adapter boundary            | Flexible inside workstation              |
| Skills outside this repo               | Yes                     | Yes                                  | Yes                                      |
| Voice + screen + same-session terminal | Additional contract     | Designed in, delivered incrementally | Natural machine-level fit                |
| Operational weight                     | Worker + providers      | Connector/runtime + providers        | Machines + capture + gateway + providers |
| Main risk                              | Framework coupling      | Overdesigning the protocol           | Infrastructure and execution exposure    |

**Recommendation:** Choose B, build only presence and voice first, and use A's speech tooling inside the first external adapter if the spike supports it. Add C-style sandboxes only when delivering screen/terminal capabilities. This is one integration boundary, not three implementations in tiny-office.

## Recommended ownership and contract sketch

Everything below is proposed vocabulary, not an implemented API or final schema. Freeze exact fields only after the first interoperability spike.

### Ownership

| Tiny-office owns                                                           | External connector/runtime owns                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Agent ID, workspace registration, accountable human owner, display profile | Agent framework, model/provider selection and credentials                           |
| Approved placement, online presence, shared interaction audience           | Prompts, skills, tools, memory and retrieval configuration                          |
| Consent state, permitted capabilities, media grants and revocation         | Speech recognition/synthesis or realtime speech model, turn-taking and interruption |
| User authorization for session attachments; lifecycle/audit metadata       | Sandboxed execution, desktop capture and terminal/PTY hosting                       |
| Typed client UI and published connector contract                           | Resource budgets, sandbox teardown, external retention enforcement                  |

Runtime configuration lives in the operator's deployment or external project. The office stores an opaque `runtimeProfileRef` and displays a safe capability summary/revision. It neither downloads nor executes skill definitions. Swapping profiles ends the current interaction, revokes its grants, renegotiates capabilities and requires renewed consent if processing policy or privileges change. No silent backend substitution during a conversation.

A declared capability is not permission. Effective access is the intersection of **runtime support, owner policy, current human authorization and current room/session state**. Enabling a new capability needs approval; losing one disables its action immediately.

### Identity and persistence

- Introduce an agent registration separate from `users` and `memberships`: workspace, stable agent ID, managing user ID, display/appearance, designated zone and validated position, runtime profile reference, approved capabilities, processing-policy revision and enabled state.
- Public participant records discriminate `human` and `agent`. Retain current human IDs; use a reserved agent namespace for browser/media identities. Never let a connector claim a human ID or an owner role.
- Keep human membership and login semantics intact. Agent metadata is not a human `Member` with a dummy email. For the MVP, place agents in meeting zones without changing human desk assignments.
- Runtime connections use a short-lived lease and an incrementing connection epoch. A replacement connection fences the previous connector and its media/session grants. Heartbeat expiry marks the agent offline and starts revocation; the avatar must not appear healthy merely because configuration exists.
- Persist registration, hashed machine credentials, grant/audit metadata and interaction lifecycle records, not live presence or transcripts. After an office restart, mark unfinished interactions interrupted and require fresh attachment authorization. Do not replay tool work.
- Separate states: connection (`offline`, `connecting`, `online`, `error`), interaction (`idle`, `starting`, `active`, `stopping`, `ended`, `failed`) and optional activity (`listening`, `thinking`, `speaking`, `working`). Activity is a bounded runtime hint, not evidence of authorization or a substitute for liveness.

### Control transport

Use a dedicated TLS WebSocket endpoint in the existing Fastify/ws server. The external connector dials it using a revocable, workspace-and-agent-scoped machine secret in an authorization header, not a URL query or human session cookie. Store only the secret hash. Human HTTP/WebSocket authentication and origin enforcement remain unchanged; the machine endpoint has its own strict authentication, payload bounds, rate limits and version negotiation.

Illustrative messages:

| Direction          | Message                                               | Meaning                                                                                                   |
| ------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Connector → office | `hello`, `heartbeat`, `capabilities`                  | Negotiate version/profile revision and keep one fenced connection alive.                                  |
| Office → connector | `interaction.start`                                   | Authoritative interaction ID, audience/zone, connection epoch, profile revision and allowed capabilities. |
| Connector → office | `interaction.ready`, `activity`, `interaction.failed` | Confirm the external session and report bounded status; never select the audience.                        |
| Office → connector | `media.grant`                                         | Short-lived credential naming exactly the approved LiveKit room and participant identity.                 |
| Office → connector | `attachment.request`, `interaction.stop`              | Request scoped screen/terminal access or stop the shared interaction.                                     |
| Connector → office | `attachment.ready`, `interaction.ended`               | Return an opaque attachment reference or acknowledge cleanup.                                             |

Requests carry unique IDs; replies carry the interaction ID and epoch. Duplicate starts/attachments must be idempotent, late replies from a fenced connection must be ignored, and a start deadline must release partial resources on failure. Reconnect requires a fresh authoritative state exchange, not blind replay of buffered requests. Default to ending interrupted interactions in v1 rather than implementing durable resumption.

Keep speech, screen frames, PTY bytes, model tokens and tool payloads off the game/control WebSocket. Use direct calls between a small participant registry and existing world/media code; no new message broker or event bus. Initially deliver the connector only its own approved session context, not the entire workspace directory or whiteboard state.

### Voice and media flow

1. An authenticated human selects Talk while in the agent's server-computed zone. The office checks the agent's lease, disclosure acceptance, enabled capabilities and human status. DND is refused.
2. The office creates one shared interaction for that agent/zone, then asks the connector to start its external work session. A second Talk joins the same interaction rather than creating competing agent voices.
3. Only after readiness and consent checks does the office issue an agent media grant. Idle avatar presence alone grants no listening access. The worker receives authorized room audio, runs its externally configured agent and publishes synthesized speech as an audio track.
4. For v1, grant agent audio publication only; enable screen publication only in its later slice. Give no camera, data-publish or SFU administration permission. Keep human media defaults separate from agent capability policy.
5. Leaving the zone or entering DND removes the human's media and attachment access. The shared agent can continue with remaining authorized occupants. No authorized humans left, explicit room-wide Stop, agent disable, lease expiry or profile change ends its interaction and revokes grants.
6. Agent and human identities both participate in authoritative SFU reconciliation. Zone/map changes and reconnects cannot leave an old agent identity authorized in a previous room.

**Important LiveKit limit:** The existing room grant allows subscription to that room, not a server-enforced subset of its publishers or track sources. An agent in the human call room can potentially receive cameras and shared screens as well as audio. Advertising an `audio` capability or asking a worker to ignore video is not an isolation boundary. The first adapter may process only audio, but disclosure must cover access to **all published room media**. If enforced audio-only access or per-person selective consent is required, stop and design a separate sanitized media relay/room; that is extra scope, not a token flag we already have.

**Consent before transmission:** Designated agent rooms display their policy before media admission. Gate server-issued human publish permissions on acceptance and explicit device activation, not merely a browser dialog. This includes existing occupants when enabling an agent, newcomers, focus users explicitly unmuting, and available-device auto-resume. For v1, pause room publication while establishing consent for a newly enabled agent; participants who decline remain out of that call or move to a human-only zone. Do not claim that non-consenting people can publish privately inside the same SFU room. A backend/policy revision invalidates previous acceptance.

**Revocation is not JWT expiry:** Two-minute tokens do not terminate existing media sessions. Use event-driven removal/permission reconciliation, fenced identities and a deny state that also catches stale-token rejoin attempts; retain the polling safety net. Measure revoke latency and test the deployed LiveKit version's token refresh/rejoin behavior. Under healthy services, target the existing two-second reconciliation bound; a stale bearer may otherwise briefly rejoin between checks. If zero-window revocation is required, stronger admission control is a release prerequisite. During SFU control outages, refuse new grants, show degraded status and stop cooperative publishers; do not claim guaranteed removal of an unreachable participant.

### Screen and terminal flow

One office `interactionId` maps to one external work session. Both watching and terminal access must resolve that mapping; showing one machine while opening a different shell is an acceptance failure.

- The runtime captures its sandbox desktop, not a human's screen. Screen sharing is an explicit, session-scoped permission and a LiveKit screen-share source so the current pin/expand UI can be reused. In v1 of this slice, the whole zone can watch; private screen viewers require a different media design.
- Terminal viewing and terminal input are separate capabilities. Start with an authenticated external session page in a new tab, not an embedded iframe or a new generic terminal proxy. If a runtime cannot enforce the grant contract, hide the action rather than exposing an unrestricted URL.
- An office-authorized, single-use, short-lived attachment exchange is bound to workspace, human, agent, interaction, connection epoch and mode. The gateway authenticates the viewer, redeems it atomically, and continuously enforces revocation/expiry; a session link is not a reusable bearer shortcut around membership checks.
- Pin the terminal origin to operator-approved HTTPS configuration. Never redirect to or fetch an arbitrary connector-supplied URL; no credentials in query strings or logs, no opener access, no raw provider HTML rendered in the office origin. Specify the exact exchange and browser-auth flow in the terminal slice's security review.
- Read-only is the default; control is an explicit elevation with an exclusive writer lease. The runtime must coordinate human input with agent tool execution, pausing conflicting agent actions while a human controls the session. No simultaneous uncontrolled writers.
- Close attachments on zone exit, DND, sign-out/revocation, profile change, interaction end or connector loss. The gateway must fail closed if its authorization lease cannot be renewed; closing a browser panel alone is not revocation.
- The execution host must be isolated from the office host: no Docker socket, host filesystem, office DB credentials or SFU admin secret. Apply resource/time limits and an explicit egress policy. Tool/repository secrets belong in the external sandbox's scoped secret system.

## Security, privacy and operational expectations

- Agents are visibly agents in avatars, people lists, call tiles and session pages. A future digital twin must identify its human sponsor without impersonating that person or inheriting their cookies/credentials.
- Only owners register/disable agents in the MVP. Ordinary members may start approved interactions, not select arbitrary endpoints, change skills, grant tools or obtain machine credentials. Credential rotation and managing-user removal have explicit disable/reassign behavior.
- Room conversation is untrusted input, not authority to run privileged tools. The external runtime enforces tool approvals and sandbox policy; the office enforces who can interact/attach. Voice instructions cannot bypass either boundary.
- Display what leaves the deployment, which operator/provider receives it, and the declared retention policy. Default office storage excludes audio, transcripts, frames and terminal output. External providers may retain data: this must be configured and disclosed, not presented as an office-enforced guarantee.
- Log lifecycle facts and access decisions (actor, agent, interaction, policy revision, time, outcome), with bounded retention and no grant secrets or conversation content. Keep operational logs separate from model memory.
- Bound active interactions, start/retry rates and grant lifetimes in the office; bound provider spend, tool duration, CPU/memory and sandbox lifetime externally. A hung model or unavailable runtime must not delay the simulation or ordinary human calls.
- No agent service is required for a normal office deployment. Ship the first real adapter in an external project/deployment; this repo owns protocol documentation and deterministic conformance fixtures only. Document HTTPS/WSS and SFU network reachability for both browser and worker.

## Roadmap and release gates

These slices are sequential and independently reviewable. Effort is relative, not a calendar estimate. This draft does not reorder the existing presence/chat plan in [PLAN.md](../../PLAN.md); approving this feature should explicitly set its priority. Each slice must pass before the next begins.

| Slice                                               | Deliverable / non-goals                                                                                                                                                                                                              | Gate                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Decision + interoperability spike (small)       | Approve B or choose another option; external worker publishes synthetic speech to self-hosted LiveKit using an office-issued scoped grant. Resolve room consent and token-rejoin limitations. No production participant feature yet. | Demonstrate audio receive/reply and interruption; record observed turn latency, deployed SDK/server compatibility and credential requirements. Decide whether room-wide media disclosure is acceptable.                                                                   |
| 1 — Participant foundation (medium)                 | Agent registration, scoped connector auth, stable identity, stationary placement, liveness, badges, accessible card, capability/version negotiation. No listening or tool execution.                                                 | Fake connector joins/reconnects without human credentials; duplicate/stale connections fence correctly; disable/expiry/map edits remove stale presence; human auth/movement/desks still pass.                                                                             |
| 2 — Voice collaboration MVP (medium–large)          | One shared interaction in one designated zone, Talk/Stop, consent/device gate, policy-derived media, external agent with an externally configured skill. No screen or terminal yet.                                                  | Two humans converse with one real external agent; interrupt a spoken reply; demonstrate one useful approved skill. DND/open-floor/cross-zone isolation, consent, stale rejoin and failure recovery pass. Change external skill/model config without changing office code. |
| 3 — Watch the work (medium)                         | Same-session sandbox screen publishing, permission and audience labels, existing expand/pin UI. No remote input.                                                                                                                     | Both authorized humans see the active agent session; cross-zone viewers cannot; stop/disconnect/zone changes revoke sharing; no human capture starts automatically.                                                                                                       |
| 4 — Attach to the work (large / security-sensitive) | Authenticated external terminal entry, read-only then explicit writer lease, sandbox requirements and access audit. Embedding can be evaluated later.                                                                                | Terminal and screen prove the same session; replay, wrong-user/workspace, arbitrary-origin, stale-epoch and expired grants fail. Zone exit/revocation kills an already-open attachment. Human control pauses conflicting agent work.                                      |
| 5 — Multiple agents and personal twins (future)     | Per-agent ACLs, personal ownership/delegation, optional private contexts, multiple profiles and bot rooms; roaming only if useful.                                                                                                   | Separate design for private memory vs shared conversations, budgets, impersonation prevention and multi-session isolation. No inherited human credentials.                                                                                                                |

The voice MVP is useful on its own. The complete initial vision is delivered only after slice 4; an avatar or voice-only demo should not be described as completing computer-use collaboration.

### Verification plan

- **Unit:** discriminated participant/capability schemas, grant intersection, consent transitions, heartbeat/epoch fencing, idempotency, attachment permissions, device auto-resume gates and media policy including agents. Reject unknown fields/versions and oversized messages at the machine boundary.
- **PostgreSQL + real WebSockets:** registration authorization, hashed-secret rotation/revocation, cross-workspace denial, lease expiry, restart recovery, duplicate connectors, profile switches and map changes. Assert agent principals cannot use human administration/auth endpoints.
- **SFU integration:** actual issued grants and actual admission/revocation, including unknown agent removal, stale JWT/refresh rejoin, no agent listening while idle, DND, zone boundaries and connector loss. Fake room-service tests alone are insufficient for these security claims.
- **Browser E2E:** two humans plus a deterministic fake external agent publishing known audio and later known screen frames; accessible selection, disclosure, no accidental device activation, Talk/Stop, pin/expand, same-session attachment and permission failures. Keep this fixture provider-free and outside the production runtime path.
- **External adapter smoke test:** manually exercise real speech, interruption, one externally defined skill and later sandbox/terminal control. Record latency and failure behavior without checking conversation content into the repo. Prove a second runtime can pass the contract before calling it portable across backends.
- **Regression/operations:** existing formatting, typecheck, unit, DB and media E2E gates; 20–30 human presence remains responsive with a slow/disconnected connector. Verify workers can reach the self-hosted SFU and ordinary Compose starts without any agent service.

## Decisions requested in this draft

1. **Architecture:** B (recommended), A for fastest voice delivery, or C if computer use is the first priority?
2. **First bot:** What useful task and external runtime should the first adapter demonstrate? Recommendation: one room-scoped work assistant with a deliberately limited skill set, not a personal twin yet.
3. **Privacy:** Is explicit room-wide media disclosure acceptable, or must agents be technically restricted to selected audio only? The latter adds a media-isolation slice before voice can ship.
4. **Session access:** Is an authenticated external terminal tab acceptable initially? Recommendation: yes; embed later only if it improves collaboration enough to justify the security/UI work.
5. **Priority and authority:** Approve voice-first sequencing and owner-managed bots? Personal bot ownership, long-term memory and autonomous action permissions require later decisions.

**Suggested next implementation PR:** After agreement and slice 0's external audio/security spike, deliver slice 1: agent identity and connector liveness with a fake connector and zero media access.
