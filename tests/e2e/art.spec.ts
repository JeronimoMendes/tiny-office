import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  move,
  parseMap,
  PROTOCOL_VERSION,
  type Input,
  type Player,
  type Member,
} from '@office/shared';

// A local rendering fixture: no authentication, database or SFU is changed.
for (const variant of ['cozy', 'legacy', 'native', 'expanded-v1', 'expanded-v1-native'] as const)
  test(`pixel office ${variant} loads, walks and previews every character`, async ({
    page,
  }, testInfo) => {
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
    await page.keyboard.up('ArrowRight');
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
      expect(await page.locator('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
        true,
      );
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
