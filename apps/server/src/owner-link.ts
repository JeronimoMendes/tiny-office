// Recovery is an operator-only CLI, not an unauthenticated web endpoint.
import { Pool } from 'pg';
import { Store, DEFAULT_WORKSPACE_ID } from './persistence/store';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://office:office@localhost:5432/office',
});
try {
  const store = new Store(pool),
    id = process.env.WORKSPACE_ID ?? DEFAULT_WORKSPACE_ID;
  const owner = (await store.members(id)).find((m) => m.role === 'owner');
  if (!owner) throw new Error('Claim the workspace first');
  const token = await store.invite(
    id,
    owner.email,
    owner.displayName,
    (await store.workspace(id)).map,
  );
  console.log(`${process.env.APP_ORIGIN ?? 'http://localhost:3000'}/#login=${token}`);
} finally {
  await pool.end();
}
