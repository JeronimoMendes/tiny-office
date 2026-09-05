import type { Heading, Member, Player, Workspace } from '@office/shared';

// The sole renderer/UI boundary. Snapshots are owned copies: the renderer can
// animate its own objects, but cannot mutate the session or React state.
export type RenderSnapshot = {
  workspace: Workspace;
  selfId: string;
  tick: number;
  receivedAt: number;
  players: Player[];
  predictedSelf: Player;
  members: Member[];
};
export interface RendererBridge {
  subscribe(listener: (snapshot: RenderSnapshot) => void): () => void;
  setHeading(heading: Heading | null): void;
}
