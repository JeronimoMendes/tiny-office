import Phaser from 'phaser';
import type { RendererBridge } from '../session/bridge';
import { OfficeScene } from './OfficeScene';

export function mountOffice(parent: HTMLElement, bridge: RendererBridge): () => void {
  let game: Phaser.Game | undefined;
  const unsubscribe = bridge.subscribe((snapshot) => {
    if (game) return;
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#3f4a40',
      pixelArt: true,
      roundPixels: true,
      scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
      scene: new OfficeScene(bridge, snapshot),
      audio: { noAudio: true },
      banner: false,
    });
  });
  const resize = new ResizeObserver(() =>
    game?.scale.resize(parent.clientWidth, parent.clientHeight),
  );
  resize.observe(parent);
  return () => {
    unsubscribe();
    resize.disconnect();
    bridge.setHeading(null);
    game?.destroy(true);
  };
}
