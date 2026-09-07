# Working in this repository

## Take a worktree, don't work in the main checkout

Someone is probably running the office in the main checkout already — a person,
or another agent. Every stack publishes real ports and holds a database volume,
so two of them in the same place fight over both. Branch into a worktree first:

```sh
wt switch --create <branch>
```

[Worktrunk](https://worktrunk.dev) reads [.config/wt.toml](.config/wt.toml) and
leaves the worktree ready to run: `node_modules` copied from the main checkout,
and a generated `.env` giving the branch its own Compose project and its own
block of ten ports, hashed from the branch name. Nothing you start there
collides with an office already up.

Without Worktrunk, `git worktree add` and then write the same `.env` by hand,
choosing a base port nobody else has taken:

```sh
tools/worktree-env.sh 12000 office_<branch> ../tiny-office/.env > .env
```

The six ports counting up from the base are the app, the development client,
PostgreSQL, and LiveKit's signaling, TCP and UDP.

## Run the office

Never assume port 3000. Read the worktree's own `.env`, which names every port
it owns, and export it for host-side commands:

```sh
set -a; . ./.env; set +a
```

| Command   | Does                                                           |
| --------- | -------------------------------------------------------------- |
| `wt up`   | Builds and starts the office on `APP_ORIGIN`                   |
| `wt dev`  | Adds the development overlay: hot reload, PostgreSQL published |
| `wt down` | Stops it and drops its database volume                         |

## Check work before handing it back

```sh
npm run format
npm run typecheck
npm test
```

`wt merge` runs the last three itself and refuses to merge if any of them fail,
so a clean `wt merge` is the check.

Integration tests need PostgreSQL published, which only the development overlay
does; `TEST_DATABASE_URL` is already in the generated `.env`. They create and
drop a temporary schema, so they leave the office alone:

```sh
wt dev -d && npm run test:integration
```

The end-to-end test claims the office it runs against, so it needs an unclaimed
one. In a worktree that is your own stack, freshly raised — `wt down && wt up`
resets it. `E2E_BASE_URL` is already in the `.env`:

```sh
E2E_ALLOW_BOOTSTRAP=1 npm run test:e2e
```

## Clean up after yourself

`wt remove <branch>` takes the worktree's containers and database volume down
with it. A branch's office is disposable, so commit anything worth keeping
first. For a worktree made by hand, run `docker compose down --volumes` before
deleting the directory, or its containers outlive it.

## Where things are

[README.md](README.md) documents the architecture, the configuration variables
and the deployment paths; its "Code map" names what lives in each directory.
[PLAN.md](PLAN.md) holds the phase gates. Read those before adding a dependency
or a service — this project keeps both counts deliberately low.
