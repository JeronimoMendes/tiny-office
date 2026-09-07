import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  move,
  parseMap,
  PROTOCOL_VERSION,
  STEP_MS,
  type Input,
  type Player,
  type Member,
} from '@office/shared';

// A local rendering fixture: no authentication, database or SFU is changed.
for (const variant of ['cozy', 'legacy', 'native', 'expanded-v1', 'expanded-v1-native'] as const)
  test(`pixel office ${variant} loads, walks and previews every character`, async ({
    page,
  }, testInfo) => {
    // Capture Phaser only inside the browser fixture; production exposes no
    // testing API. Measure actual displayed positions, not server coordinates.
    if (variant === 'cozy') {
      // This variant also traces motion and walks the whole wardrobe.
      test.slow();
      await page.addInitScript(() => {
        const browser = window as typeof window & { officeTestGame?: import('phaser').Game };
        let phaser: typeof import('phaser');
        Object.defineProperty(window, 'Phaser', {
          configurable: true,
          get: () => phaser,
          set: (value: typeof import('phaser')) => {
            phaser = value;
            const Game = value.Game;
            value.Game = class extends Game {
              constructor(config: Phaser.Types.Core.GameConfig) {
                super(config);
                browser.officeTestGame = this;
              }
            };
          },
        });
      });
    }
    const map = parseMap(
      JSON.parse(
        await readFile(
          variant === 'legacy' ? 'tests/fixtures/office-legacy.tmj' : 'maps/office.tmj',
          'utf8',
        ),
      ),
    );
    // Early expanded revisions were persisted before the tileset was renamed.
    // Their 40 GIDs must never be interpreted using the original eight-tile PNG.
    if (variant.startsWith('expanded-v1')) map.tiled.tilesets[0].image = '../assets/office.png';
    const native = variant.endsWith('native');
    const members: Member[] = ['Robin', 'Penny', 'Jules', 'Sam', 'Fern', 'Kai', 'Ash', 'Wren'].map(
      (displayName, character) => ({
        id: `art-${character}`,
        displayName,
        character,
        email: `${character}@example.test`,
        status: 'free' as const,
        role: 'member' as const,
      }),
    );
    const workspace = {
      id: 'art',
      name: 'Tiny Office',
      mapRevision: 'art-preview',
      map: map.tiled,
      desks: {},
    };
    const players: Player[] = members.map((m, i) => ({
      ...m,
      x: 480 + (i % 4) * 64,
      y: 490 + Math.floor(i / 4) * 64,
      direction: 'down',
      moving: false,
      zoneId: null,
    }));
    const errors: string[] = [];
    const loaded = new Set<string>();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/assets/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      loaded.add(pathname);
      if (native && pathname.endsWith('@4x.png')) {
        await route.fulfill({ status: 404, body: 'No supersampled sibling' });
        return;
      }
      await route.fulfill({ path: resolve(`.${pathname}`) });
    });
    let failSave = false;
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/profile')) {
        if (failSave)
          return route.fulfill({ status: 500, json: { error: 'Please try saving again.' } });
        Object.assign(members[0], route.request().postDataJSON());
        Object.assign(players[0], members[0]);
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({
        json: path.endsWith('/bootstrap')
          ? { required: false }
          : path.endsWith('/session')
            ? { user: members[0], members, workspace }
            : { enabled: false, reason: 'Art preview' },
      });
    });
    let tick = 0;
    const inputs: number[] = [];
    await page.routeWebSocket('**/ws', (socket) => {
      socket.send(
        JSON.stringify({
          type: 'welcome',
          version: PROTOCOL_VERSION,
          selfId: players[0].id,
          tick,
          players,
          members,
          workspace,
        }),
      );
      socket.onMessage((raw) => {
        inputs.push(Date.now());
        const input = JSON.parse(raw.toString()) as Input;
        Object.assign(players[0], move(map, players[0], input.heading));
        socket.send(
          JSON.stringify({
            type: 'delta',
            tick: ++tick,
            ack: input.seq,
            changedPlayers: [players[0]],
            removedPlayerIds: [],
          }),
        );
      });
    });
    await page.goto('/');
    await expect(page.getByTestId('connection')).toHaveText('8 here');
    await expect(page.locator('canvas')).toBeVisible();
    await expect.poll(() => loaded.has('/assets/props.json')).toBe(true);
    // Give the GPU a pair of rendered frames after the loader completes.
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await page.getByRole('button', { name: 'Hide participants' }).click();
    await page.screenshot({ path: testInfo.outputPath('office.png') });
    const start = players[0].x;
    await page.keyboard.down('ArrowRight');
    await expect.poll(() => players[0].x).toBeGreaterThan(start + 16);
    if (variant === 'cozy') {
      const walkedFrom = inputs.length;
      const trace = await page.evaluate(async () => {
        const game = (window as typeof window & { officeTestGame: import('phaser').Game })
          .officeTestGame;
        const scene = game.scene.getScene('office');
        const avatar = scene.children.list.find(
          (child) => child.type === 'Container',
        ) as Phaser.GameObjects.Container;
        const samples: { time: number; x: number }[] = [];
        await new Promise<void>((resolve) => {
          const record = () => {
            samples.push({ time: performance.now(), x: avatar.x });
            if (samples.length === 40) {
              game.events.off('poststep', record);
              resolve();
            }
          };
          game.events.on('poststep', record);
        });
        return {
          samples,
          roundPixels: game.config.roundPixels,
          cameraRoundPixels: scene.cameras.main.roundPixels,
        };
      });
      const median = (values: number[]) =>
        values
          .slice(1)
          .map((value, i) => value - values[i])
          .sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];
      const frame = median(trace.samples.map((sample) => sample.time));
      const step = median(inputs.slice(walkedFrom));
      // A frame may speculate up to one step past the last input it sent, so a
      // browser starved enough to send those late really does walk slower than
      // SPEED — measuring easing there would measure the runner instead. Frame
      // length alone is harmless, and a movement regression still fails here:
      // this reads the 15 Hz input loop, not the distance covered.
      if (step < STEP_MS * 1.3) {
        const speeds = trace.samples
          .slice(1)
          .flatMap((sample, i) => {
            const elapsed = sample.time - trace.samples[i].time;
            // Ignore scheduling stalls, relative to how fast this browser draws:
            // this checks cadence, not the CI GPU's FPS.
            return elapsed >= frame / 2 && elapsed <= frame * 2
              ? [(1000 * (sample.x - trace.samples[i].x)) / elapsed]
              : [];
          })
          .sort((a, b) => a - b);
        expect(speeds.length).toBeGreaterThan(15);
        expect(speeds[Math.floor(speeds.length / 2)]).toBeGreaterThan(100);
        expect(speeds[Math.floor(speeds.length / 2)]).toBeLessThan(140);
        // Compare the central distribution: occasional timer starvation in a
        // headless browser may hit the deliberate speculation limit. Old easing
        // varied from near-zero to >200px/s throughout every network tick.
        expect(
          speeds[Math.floor(speeds.length * 0.8)] / speeds[Math.floor(speeds.length * 0.2)],
        ).toBeLessThan(1.7);
      } else
        testInfo.annotations.push({
          type: 'cadence',
          description: `Input loop starved to ${step.toFixed(0)}ms a step; cadence not measured`,
        });
      expect(trace.roundPixels).toBe(false);
      expect(trace.cameraRoundPixels).toBe(false);
    }
    await page.keyboard.up('ArrowRight');
    if (variant === 'cozy') {
      const stoppedPositions = await page.evaluate(async () => {
        const game = (window as typeof window & { officeTestGame: import('phaser').Game })
          .officeTestGame;
        const avatar = game.scene
          .getScene('office')
          .children.list.find(
            (child) => child.type === 'Container',
          ) as Phaser.GameObjects.Container;
        return new Promise<number[]>((resolve) => {
          const positions: number[] = [];
          const record = () => {
            positions.push(avatar.x);
            if (positions.length === 20) {
              game.events.off('poststep', record);
              resolve(positions);
            }
          };
          game.events.on('poststep', record);
        });
      });
      expect(Math.max(...stoppedPositions) - Math.min(...stoppedPositions)).toBeLessThan(0.001);
    }
    await expect.poll(() => players[0].moving).toBe(false);
    await page.getByRole('button', { name: /Robin Edit your character/ }).click();
    await page.getByText('Start with an outfit').click();
    for (let i = 1; i <= 8; i++) {
      const choice = page.getByRole('button', { name: `Character ${i}`, exact: true });
      await choice.click();
      await expect(choice).toHaveAttribute('aria-pressed', 'true');
    }
    await page.getByText('Start with an outfit').click();
    await page.screenshot({ path: testInfo.outputPath('wardrobe.png') });
    if (variant === 'cozy') {
      for (const [category, option] of [
        ['Head', 'Square'],
        ['Skin', 'Skin tone 6'],
        ['Hair', 'Bald'],
        ['Shirts', 'Hoodie'],
        ['Pants', 'Shorts'],
        ['Shoes', 'Sandals'],
        ['Accessories', 'None'],
        ['Hats', 'None'],
      ]) {
        await page
          .getByRole('group', { name: 'Character parts' })
          .getByRole('button', { name: category, exact: true })
          .click();
        await page.getByRole('button', { name: option, exact: true }).click();
        await expect(page.getByRole('button', { name: option, exact: true })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      }
      for (const direction of ['left', 'back', 'right', 'front']) {
        await page.getByRole('button', { name: `View ${direction}` }).click();
        await expect(page.getByRole('button', { name: `View ${direction}` })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      }
      await page.screenshot({ path: testInfo.outputPath('mixed-wardrobe.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: testInfo.outputPath('mobile-wardrobe.png') });
      expect(
        await page
          .getByRole('dialog', { name: 'A little more you.' })
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      failSave = true;
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(page.getByRole('alert')).toContainText('Please try saving again.');
      await expect(page.getByRole('dialog')).toBeVisible();
      failSave = false;
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(members[0].appearance).toMatchObject({
        head: 2,
        skin: 5,
        hair: 8,
        shirt: 1,
        pants: 3,
        shoes: 3,
        accessory: 0,
        hat: 0,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.reload();
      await expect(page.getByTestId('connection')).toHaveText('8 here');
      await page.getByRole('button', { name: /Robin Edit your character/ }).click();
      await expect(page.getByRole('button', { name: 'Square', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page
        .getByRole('group', { name: 'Character parts' })
        .getByRole('button', { name: 'Hair', exact: true })
        .click();
      await expect(page.getByRole('button', { name: 'Bald', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('button', { name: 'Curly', exact: true }).click();
      await page.getByRole('button', { name: 'Close profile' }).click();
      await page.getByRole('button', { name: /Robin Edit your character/ }).click();
      await page
        .getByRole('group', { name: 'Character parts' })
        .getByRole('button', { name: 'Hair', exact: true })
        .click();
      await expect(page.getByRole('button', { name: 'Bald', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
    expect([...loaded]).toEqual(
      expect.arrayContaining([
        '/assets/wardrobe/head.png',
        variant === 'legacy' ? '/assets/office@4x.png' : '/assets/office-cozy@4x.png',
        '/assets/props.png',
      ]),
    );
    if (native) expect(loaded.has('/assets/office-cozy.png')).toBe(true);
    if (variant.startsWith('expanded-v1')) {
      expect(loaded.has('/assets/office.png')).toBe(false);
      expect(loaded.has('/assets/office@4x.png')).toBe(false);
    }
    if (variant === 'cozy') {
      // Verify the actual exported layers can reconstruct all 96 preset frames.
      const differences = await page.evaluate(async () => {
        const manifest = await (await fetch('/assets/avatars.json')).json();
        const load = async (url: string) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          return img;
        };
        const flat = await load('/assets/avatars.png');
        const canvas = document.createElement('canvas');
        canvas.width = flat.width;
        canvas.height = flat.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(flat, 0, 0);
        const expected = ctx.getImageData(0, 0, flat.width, flat.height).data;
        ctx.clearRect(0, 0, flat.width, flat.height);
        for (const layer of manifest.layerOrder)
          ctx.drawImage(await load(`/assets/${manifest.layers[layer]}`), 0, 0);
        const actual = ctx.getImageData(0, 0, flat.width, flat.height).data;
        return actual.reduce((count, value, i) => count + Number(value !== expected[i]), 0);
      });
      expect(differences).toBe(0);
      await page.getByRole('button', { name: 'Close profile' }).click();
      await page.setViewportSize({ width: 2600, height: 1850 });
      await page.screenshot({ path: testInfo.outputPath('full-office.png') });
    }
    expect(errors).toEqual([]);
  });
