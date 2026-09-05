import { z } from 'zod';
import type { TiledMap } from './map';
import type { Motion } from './movement';
export const PROTOCOL_VERSION = 1;
export const statusSchema = z.enum(['free', 'focus', 'do-not-disturb']);
export const directionSchema = z.enum(['up', 'down', 'left', 'right']);
export const clientMessageSchema = z
  .object({
    type: z.literal('input'),
    seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    direction: directionSchema.nullable(),
  })
  .strict();
export type Input = z.infer<typeof clientMessageSchema>;
export type Status = z.infer<typeof statusSchema>;
export type Player = Motion & {
  id: string;
  displayName: string;
  character: number;
  status: Status;
  zoneId: string | null;
};
export type Member = {
  id: string;
  email: string;
  displayName: string;
  character: number;
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
  | { type: 'error'; code: string; message: string };
export const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40),
    character: z.number().int().min(0).max(7),
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
