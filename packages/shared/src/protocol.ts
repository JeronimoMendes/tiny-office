import { z } from 'zod';
import { appearanceSchema, type Appearance } from './appearance';
import type { TiledMap } from './map';
import { headings, type Motion } from './movement';
export const PROTOCOL_VERSION = 5;
export const statusSchema = z.enum(['free', 'focus', 'do-not-disturb']);
export const headingSchema = z.enum(
  Object.keys(headings) as [keyof typeof headings, ...(keyof typeof headings)[]],
);
const inputSchema = z
  .object({
    type: z.literal('input'),
    seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    heading: headingSchema.nullable(),
  })
  .strict();
const whiteboardRecordSchema = z.object({ id: z.string().min(1).max(200) }).passthrough();
const whiteboardPresenceSchema = z
  .object({
    id: z.string().min(1).max(200),
    typeName: z.literal('instance_presence'),
    userId: z.string().min(1).max(200),
  })
  .passthrough();
const whiteboardChangesSchema = z
  .object({
    put: z.array(whiteboardRecordSchema).max(500),
    remove: z.array(z.string().min(1).max(200)).max(500),
  })
  .strict();
export const clientMessageSchema = z.discriminatedUnion('type', [
  inputSchema,
  z.object({ type: z.literal('whiteboard-open'), zoneId: z.string().max(100) }).strict(),
  z
    .object({
      type: z.literal('whiteboard-changes'),
      zoneId: z.string().max(100),
      changes: whiteboardChangesSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('whiteboard-presence'),
      zoneId: z.string().max(100),
      presence: whiteboardPresenceSchema,
    })
    .strict(),
  z.object({ type: z.literal('whiteboard-close'), zoneId: z.string().max(100) }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type Input = z.infer<typeof inputSchema>;
export type WhiteboardRecord = z.infer<typeof whiteboardRecordSchema>;
export type WhiteboardChanges = z.infer<typeof whiteboardChangesSchema>;
export type WhiteboardPresence = z.infer<typeof whiteboardPresenceSchema>;
export type WhiteboardState = {
  zoneId: string;
  records: WhiteboardRecord[];
  presences: WhiteboardPresence[];
  editorIds: string[];
};
export type Status = z.infer<typeof statusSchema>;
export type Player = Motion & {
  id: string;
  displayName: string;
  character: number;
  appearance?: Appearance | null;
  status: Status;
  zoneId: string | null;
};
export type Member = {
  id: string;
  email: string;
  displayName: string;
  character: number;
  appearance?: Appearance | null;
  role: 'owner' | 'member';
  status: Status;
};
export type DeskAssignments = Record<string, string>;
export type Workspace = {
  id: string;
  name: string;
  mapRevision: string;
  map: TiledMap;
  desks: DeskAssignments;
};
export type SessionInfo = { user: Member; workspace: Workspace; members: Member[] };
export type ServerMessage =
  | {
      type: 'welcome';
      version: number;
      selfId: string;
      tick: number;
      players: Player[];
      members: Member[];
      workspace: Workspace;
    }
  | {
      type: 'delta';
      tick: number;
      ack: number;
      changedPlayers: Player[];
      removedPlayerIds: string[];
    }
  | { type: 'members'; members: Member[]; desks: DeskAssignments }
  | { type: 'whiteboard-state'; board: WhiteboardState }
  | { type: 'whiteboard-changes'; zoneId: string; changes: WhiteboardChanges }
  | { type: 'whiteboard-editors'; zoneId: string; editorIds: string[] }
  | {
      type: 'whiteboard-presence';
      zoneId: string;
      userId: string;
      presence: WhiteboardPresence | null;
    }
  | { type: 'whiteboard-ended'; zoneId: string }
  | { type: 'error'; code: string; message: string };
export const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40),
    character: z.number().int().min(0).max(7),
    appearance: appearanceSchema.nullable().optional(),
  })
  .strict();
export const inviteSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    displayName: z.string().trim().min(1).max(40),
  })
  .strict();
