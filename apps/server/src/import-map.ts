import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { Store, DEFAULT_WORKSPACE_ID } from './persistence/store';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://office:office@localhost:5432/office',
});
const store = new Store(pool),
  id = process.env.WORKSPACE_ID ?? DEFAULT_WORKSPACE_ID;
const lock = await pool.connect();
try {
  if (
    !(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [id]))
      .rows[0].acquired
  )
    throw new Error('Stop the app before importing a map');
  const revision = await store.importMap(
    id,
    JSON.parse(await readFile(process.argv[2] ?? 'maps/office.tmj', 'utf8')),
  );
  console.log(`Imported map revision ${revision}. Restart the app to load it.`);
} finally {
  lock.release(true);
  await pool.end();
}
