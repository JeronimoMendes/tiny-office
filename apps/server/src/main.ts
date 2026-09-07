import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { Store, DEFAULT_WORKSPACE_ID } from './persistence/store';
import { newSecret } from './auth/secrets';
import { createMailer } from './auth/mailer';
import { createApp } from './app';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://office:office@localhost:5432/office',
  max: 10,
  connectionTimeoutMillis: 5000,
});
pool.on('error', (error) => console.error('Database pool error', error));
const store = new Store(pool);
const workspaceId = process.env.WORKSPACE_ID ?? DEFAULT_WORKSPACE_ID;
const port = Number(process.env.PORT ?? 3000);
const origin = new URL(process.env.APP_ORIGIN ?? `http://localhost:${port}`).origin;
await store.migrate();
// A DB advisory lock is only a guard against accidentally running two writers;
// no distributed simulation or failover is implemented.
const lock = await pool.connect();
if (
  !(
    await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [
      workspaceId,
    ])
  ).rows[0].acquired
)
  throw new Error('Workspace already running in another process');
lock.on('error', (error) => {
  console.error('Lost workspace lock connection; stopping', error);
  process.exit(1);
});
if (!(await pool.query('SELECT 1 FROM workspaces WHERE id=$1', [workspaceId])).rowCount) {
  await store.ensureWorkspace(
    workspaceId,
    JSON.parse(await readFile(process.env.MAP_FILE ?? 'maps/office.tmj', 'utf8')),
  );
}
const mailer = createMailer();
if (mailer.enabled)
  // Report an unreachable or rejecting SMTP server at boot instead of leaving
  // it to be discovered by the first person who cannot sign in.
  void mailer
    .verify?.()
    .catch((error: Error) =>
      console.error(`SMTP server refused the connection check: ${error.message}`),
    );
else
  console.log(
    'Email sign-in is off (set SMTP_URL and MAIL_FROM). Members who lose their session need a link from the owner, and the owner needs `npm run auth:owner-link`.',
  );
const bootstrapSecret = process.env.BOOTSTRAP_SECRET || newSecret();
if (!(await store.hasOwner(workspaceId)))
  console.log(`\nClaim your workspace at ${origin}\nBootstrap secret: ${bootstrapSecret}\n`);
const { app } = await createApp(store, {
  workspaceId,
  origin,
  bootstrapSecret,
  mailer,
  livekit: {
    apiUrl: process.env.LIVEKIT_URL,
    wsUrl: process.env.LIVEKIT_WS_URL,
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
  },
});
await app.listen({ port, host: '0.0.0.0' });
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => {
    console.error('Shutdown exceeded 10 seconds');
    process.exit(1);
  }, 10000).unref();
  try {
    await app.close();
    await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [workspaceId]);
    lock.release();
    await pool.end();
    clearTimeout(deadline);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
