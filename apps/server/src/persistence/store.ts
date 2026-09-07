import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import {
  canStand,
  parseMap,
  type Appearance,
  type DeskAssignments,
  type Member,
  type TiledMap,
  type Workspace,
} from '@office/shared';
import { hashSecret, newSecret } from '../auth/secrets';

export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export type SavedMember = Member & { x: number; y: number };
export type SavedPosition = { id: string; x: number; y: number };
export type Identity = {
  userId: string;
  workspaceId: string;
  role: 'owner' | 'member';
  expiresAt: Date;
};
const memberColumns =
  'u.id, u.email, u.display_name AS "displayName", u.character, u.appearance, m.role, m.status, m.x, m.y';

export class Store {
  constructor(readonly pool: Pool) {}
  async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const value = await fn(db);
      await db.query('COMMIT');
      return value;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  async migrate() {
    const sql = await readFile('apps/server/src/persistence/001_initial.sql', 'utf8');
    await this.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(74101)');
      await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)');
      if (!(await db.query('SELECT 1 FROM schema_migrations WHERE version = 1')).rowCount) {
        await db.query(sql);
        await db.query('INSERT INTO schema_migrations VALUES (1)');
      }
      if (!(await db.query('SELECT 1 FROM schema_migrations WHERE version = 2')).rowCount) {
        await db.query('ALTER TABLE users ADD COLUMN appearance jsonb');
        await db.query('INSERT INTO schema_migrations VALUES (2)');
      }
    });
  }
  async ensureWorkspace(id: string, input: unknown) {
    // Seed only once. Subsequent boots restore the DB revision, not the file.
    if ((await this.pool.query('SELECT 1 FROM workspaces WHERE id=$1', [id])).rowCount) return;
    await this.transaction(async (db) => {
      await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        id,
        'Tiny Office',
      ]);
      const row = await db.query('SELECT map_revision FROM workspaces WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      if (!row.rows[0].map_revision) await this.saveMap(db, id, input);
    });
  }
  private async saveMap(db: PoolClient, id: string, input: unknown) {
    const map = parseMap(input);
    if (!canStand(map, map.spawn.x, map.spawn.y)) throw new Error('Spawn must be walkable');
    const revision = createHash('sha256').update(JSON.stringify(map.tiled)).digest('hex');
    await db.query(
      'INSERT INTO workspace_maps(workspace_id, revision, definition) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, revision, JSON.stringify(map.tiled)],
    );
    await db.query('UPDATE workspaces SET map_revision=$2 WHERE id=$1', [id, revision]);
    await db.query(
      'DELETE FROM desk_assignments WHERE workspace_id=$1 AND NOT (zone_id = ANY($2::text[]))',
      [id, map.zones.filter((z) => z.kind === 'desk').map((z) => z.id)],
    );
    return revision;
  }
  async importMap(id: string, input: unknown) {
    return this.transaction(async (db) => {
      if (!(await db.query('SELECT 1 FROM workspaces WHERE id=$1 FOR UPDATE', [id])).rowCount)
        throw new Error('Workspace does not exist');
      return this.saveMap(db, id, input);
    });
  }
  async updateMap(id: string, expectedRevision: string, input: unknown) {
    return this.transaction(async (db) => {
      const current = await db.query('SELECT map_revision FROM workspaces WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      if (!current.rows[0]) throw new Error('Workspace does not exist');
      if (current.rows[0].map_revision !== expectedRevision)
        throw Object.assign(
          new Error('The workspace changed since you loaded it. Reload before saving.'),
          {
            statusCode: 409,
          },
        );
      return this.saveMap(db, id, input);
    });
  }
  async workspace(id: string): Promise<Workspace> {
    const { rows } = await this.pool.query(
      'SELECT w.id,w.name,w.map_revision AS "mapRevision", m.definition AS map FROM workspaces w JOIN workspace_maps m ON m.workspace_id=w.id AND m.revision=w.map_revision WHERE w.id=$1',
      [id],
    );
    if (!rows[0]) throw new Error('Workspace not found');
    return { ...rows[0], desks: await this.desks(id) };
  }
  async desks(id: string): Promise<DeskAssignments> {
    const { rows } = await this.pool.query(
      'SELECT zone_id, user_id FROM desk_assignments WHERE workspace_id=$1',
      [id],
    );
    return Object.fromEntries(rows.map((r) => [r.zone_id, r.user_id]));
  }
  async members(id: string): Promise<SavedMember[]> {
    return (
      await this.pool.query(
        `SELECT ${memberColumns} FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.display_name`,
        [id],
      )
    ).rows;
  }
  async hasOwner(id: string) {
    return !!(
      await this.pool.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND role='owner'", [
        id,
      ])
    ).rowCount;
  }
  async bootstrap(workspaceId: string, email: string, displayName: string, map: TiledMap) {
    const { spawn } = parseMap(map);
    return this.transaction(async (db) => {
      await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
      if (
        (
          await db.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND role='owner'", [
            workspaceId,
          ])
        ).rowCount
      )
        throw new Error('Workspace already claimed');
      const user = await db.query(
        'INSERT INTO users(id,email,display_name) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id',
        [randomUUID(), email, displayName],
      );
      const userId = user.rows[0].id;
      await db.query(
        "INSERT INTO memberships(workspace_id,user_id,role,x,y) VALUES($1,$2,'owner',$3,$4)",
        [workspaceId, userId, spawn.x, spawn.y],
      );
      return this.createSession(db, workspaceId, userId);
    });
  }
  async invite(workspaceId: string, email: string, displayName: string, map: TiledMap) {
    const { spawn } = parseMap(map),
      token = newSecret();
    await this.transaction(async (db) => {
      const user = await db.query(
        'INSERT INTO users(id,email,display_name) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id',
        [randomUUID(), email, displayName],
      );
      const userId = user.rows[0].id;
      await db.query(
        "INSERT INTO memberships(workspace_id,user_id,role,x,y) VALUES($1,$2,'member',$3,$4) ON CONFLICT DO NOTHING",
        [workspaceId, userId, spawn.x, spawn.y],
      );
      await db.query('DELETE FROM login_tokens WHERE workspace_id=$1 AND user_id=$2', [
        workspaceId,
        userId,
      ]);
      await db.query(
        "INSERT INTO login_tokens(hash,workspace_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')",
        [hashSecret(token), workspaceId, userId],
      );
    });
    return token;
  }
  private async createSession(db: PoolClient, workspaceId: string, userId: string) {
    const token = newSecret();
    await db.query(
      "INSERT INTO sessions(hash,workspace_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",
      [hashSecret(token), workspaceId, userId],
    );
    return token;
  }
  async redeem(token: string): Promise<string | null> {
    return this.transaction(async (db) => {
      const { rows } = await db.query(
        'UPDATE login_tokens SET consumed_at=now() WHERE hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING workspace_id,user_id',
        [hashSecret(token)],
      );
      return rows[0] ? this.createSession(db, rows[0].workspace_id, rows[0].user_id) : null;
    });
  }
  async identity(token: string): Promise<Identity | null> {
    const { rows } = await this.pool.query(
      'SELECT s.user_id AS "userId",s.workspace_id AS "workspaceId",m.role,s.expires_at AS "expiresAt" FROM sessions s JOIN memberships m ON m.workspace_id=s.workspace_id AND m.user_id=s.user_id WHERE s.hash=$1 AND s.expires_at>now()',
      [hashSecret(token)],
    );
    return rows[0] ?? null;
  }
  async logout(token: string) {
    await this.pool.query('DELETE FROM sessions WHERE hash=$1', [hashSecret(token)]);
  }
  async cleanup() {
    await this.pool.query('DELETE FROM sessions WHERE expires_at < now()');
    await this.pool.query(
      'DELETE FROM login_tokens WHERE expires_at < now() OR consumed_at IS NOT NULL',
    );
  }
  async profile(
    userId: string,
    displayName: string,
    character: number,
    appearance?: Appearance | null,
  ) {
    await this.pool.query(
      'UPDATE users SET display_name=$2,character=$3,appearance=$4 WHERE id=$1',
      [userId, displayName, character, appearance ? JSON.stringify(appearance) : null],
    );
  }
  async status(workspaceId: string, userId: string, status: Member['status']) {
    await this.pool.query('UPDATE memberships SET status=$3 WHERE workspace_id=$1 AND user_id=$2', [
      workspaceId,
      userId,
      status,
    ]);
  }
  async assignDesk(workspaceId: string, zoneId: string, userId: string | null) {
    await this.transaction(async (db) => {
      // Serialize owner edits; each person has at most one desk.
      await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
      await db.query(
        'DELETE FROM desk_assignments WHERE workspace_id=$1 AND (zone_id=$2 OR user_id=$3)',
        [workspaceId, zoneId, userId],
      );
      if (userId)
        await db.query(
          'INSERT INTO desk_assignments(workspace_id,zone_id,user_id) VALUES($1,$2,$3)',
          [workspaceId, zoneId, userId],
        );
    });
  }
  async claimDesk(workspaceId: string, zoneId: string, userId: string): Promise<boolean> {
    return this.transaction(async (db) => {
      // Claims and owner swaps share this lock, so two people can never take the
      // same apparently available desk.
      await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
      const occupant = await db.query(
        'SELECT user_id FROM desk_assignments WHERE workspace_id=$1 AND zone_id=$2',
        [workspaceId, zoneId],
      );
      if (occupant.rows[0] && occupant.rows[0].user_id !== userId) return false;
      await db.query('DELETE FROM desk_assignments WHERE workspace_id=$1 AND user_id=$2', [
        workspaceId,
        userId,
      ]);
      await db.query(
        'INSERT INTO desk_assignments(workspace_id,zone_id,user_id) VALUES($1,$2,$3) ON CONFLICT (workspace_id,zone_id) DO UPDATE SET user_id=EXCLUDED.user_id',
        [workspaceId, zoneId, userId],
      );
      return true;
    });
  }
  async savePositions(workspaceId: string, positions: SavedPosition[]) {
    if (!positions.length) return;
    await this.pool.query(
      `UPDATE memberships m SET x=p.x,y=p.y FROM jsonb_to_recordset($2::jsonb) AS p(id uuid,x double precision,y double precision) WHERE m.workspace_id=$1 AND m.user_id=p.id`,
      [workspaceId, JSON.stringify(positions)],
    );
  }
}
