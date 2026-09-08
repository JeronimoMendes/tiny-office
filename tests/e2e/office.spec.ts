import { expect, test, type Page } from '@playwright/test';
import type { Input, Player, ServerMessage, SessionInfo } from '@office/shared';

function observePlayers(page: Page) {
  const players = new Map<string, Player>();
  let sentSeq = 0;
  let stopSeq = 0;
  let ack = 0;
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/ws') return;
    sentSeq = stopSeq = ack = 0;
    socket.on('framesent', ({ payload }) => {
      const message = JSON.parse(payload.toString()) as { type: string } | Input;
      if (message.type !== 'input' || !('seq' in message)) return;
      sentSeq = message.seq;
      if (message.heading === null) stopSeq = message.seq;
    });
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(payload.toString()) as ServerMessage;
      if (message.type === 'welcome') {
        players.clear();
        for (const p of message.players) players.set(p.id, p);
      }
      if (message.type === 'delta') {
        ack = message.ack;
        for (const id of message.removedPlayerIds) players.delete(id);
        for (const p of message.changedPlayers) players.set(p.id, p);
      }
    });
  });
  return Object.assign(players, {
    async releaseKeys(...keys: string[]) {
      const before = sentSeq;
      for (const key of keys) await page.keyboard.up(key);
      // An idle tick can report moving:false before keyup reaches the server.
      // Wait for a null-heading input sent after release and its acknowledgement.
      await expect.poll(() => stopSeq).toBeGreaterThan(before);
      const released = stopSeq;
      await expect.poll(() => ack).toBeGreaterThanOrEqual(released);
    },
  });
}

test('owner invites a coworker, both move, profile/desks persist and reconnect restores position', async ({
  page,
  browser,
  baseURL,
}) => {
  // One office, two browsers and an SFU on a single runner: this walks, calls,
  // changes availability twice, reloads and rejoins before it is done.
  test.setTimeout(300_000);
  if (process.env.E2E_ALLOW_BOOTSTRAP !== '1')
    throw new Error(
      'Use an isolated empty office and set E2E_ALLOW_BOOTSTRAP=1. This test claims its workspace.',
    );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const ownerPlayers = observePlayers(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make yourself at home.' })).toBeVisible();
  await page
    .getByLabel('Bootstrap secret')
    .fill(process.env.BOOTSTRAP_SECRET ?? 'office-e2e-secret');
  await page.getByLabel('Your email').fill('alice@example.test');
  await page.getByLabel('Display name').fill('Alice');
  await page.getByRole('button', { name: 'Create my office' }).click();
  await expect(page.getByTestId('connection')).toHaveText('1 here');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand call', exact: true })).toHaveCount(0);
  const owner = ((await (await page.request.get('/api/session')).json()) as SessionInfo).user;
  await page.getByText('Manage office').click();
  await page.getByLabel('Member email').fill('bob@example.test');
  await page.getByLabel('Member name').fill('Bob');
  await page.getByRole('button', { name: 'Create sign-in link' }).click();
  const linkField = page.getByLabel('Personal sign-in link');
  await expect(linkField).toBeVisible();
  const link = await linkField.inputValue();
  const coworkerContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const coworker = await coworkerContext.newPage(),
    coworkerPlayers = observePlayers(coworker);
  coworker.on('pageerror', (error) => errors.push(error.message));
  await coworker.goto(link);
  await expect(coworker.getByTestId('connection')).toHaveText('2 here');
  await expect(page.getByTestId('connection')).toHaveText('2 here');
  expect(new URL(coworker.url()).hash).toBe('');
  const bob = ((await (await coworker.request.get('/api/session')).json()) as SessionInfo).user;
  await page.getByLabel('Assign Desk 1', { exact: true }).selectOption(bob.id);
  await expect
    .poll(
      async () => (await (await page.request.get('/api/session')).json()).workspace.desks['desk-1'],
    )
    .toBe(bob.id);
  await page.getByText('Manage office').click();
  await page.getByRole('button', { name: /Alice Edit your character/ }).click();
  await page.getByLabel('Display name').fill('Alice Oak');
  await page.getByText('Start with an outfit').click();
  await page.getByRole('button', { name: 'Character 4', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(coworker.getByTestId(`person-${owner.id}`)).toContainText('Alice Oak');

  const start = ownerPlayers.get(owner.id)!;
  // Clicking UI must not require a second click on the map to resume walking.
  await page.getByRole('button', { name: 'Hide participants', exact: true }).click();
  await page.getByRole('button', { name: 'Show participants', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hide participants', exact: true })).toBeFocused();
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => coworkerPlayers.get(owner.id)?.x).toBeGreaterThan(start.x + 48);
  await ownerPlayers.releaseKeys('ArrowRight');
  await expect.poll(() => ownerPlayers.get(owner.id)?.moving).toBe(false);
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => coworkerPlayers.get(owner.id)?.zoneId).toBe('desk-7');
  await ownerPlayers.releaseKeys('ArrowRight');
  await expect.poll(() => ownerPlayers.get(owner.id)?.moving).toBe(false);
  await expect(coworker.getByTestId(`person-${owner.id}`)).toContainText('Desk 7');
  await expect(page.getByRole('button', { name: 'Expand call', exact: true })).toHaveCount(0);
  const saved = { ...ownerPlayers.get(owner.id)! };
  expect(saved.y).toBe(start.y);

  // Both enter one authoritative call zone. Browser media uses Chromium's fake
  // microphone/camera so this verifies a real SFU connection without host devices.
  await coworker.locator('.map-stage').click({ position: { x: 600, y: 450 } });
  await coworker.keyboard.down('ArrowRight');
  await expect.poll(() => coworkerPlayers.get(bob.id)?.zoneId).toBe('desk-7');
  await coworkerPlayers.releaseKeys('ArrowRight');
  await expect(page.getByRole('button', { name: 'Stop video', exact: true })).toBeEnabled();
  await expect(coworker.getByRole('button', { name: 'Stop video', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeEnabled();
  await expect(coworker.getByRole('button', { name: 'Mute', exact: true })).toBeEnabled();
  await expect(page.locator('.media-tile[data-local] video')).toHaveCount(1);
  await expect(page.locator('.media-tile[data-local] .media-name')).toHaveText('Alice Oak (you)');
  const ownerTile = coworker.locator(`.media-tile[data-participant="${owner.id}"]`);
  await expect(ownerTile.locator('video')).toHaveCount(1, { timeout: 10_000 });
  await expect(ownerTile.locator('.media-name')).toHaveText('Alice Oak');

  // Expanding is local layout only: the same playing video grows to fill the
  // call panel, leaving workspace edges visible. Keyboard movement is blocked,
  // and Escape restores the strip.
  const expand = coworker.getByRole('button', { name: 'Expand call', exact: true });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  const video = await ownerTile.locator('video').elementHandle();
  const compactBounds = await ownerTile.boundingBox();
  await expand.click();
  const focusedCall = coworker.getByRole('dialog', { name: 'Focused call' });
  await expect(focusedCall).toBeVisible();
  const callBounds = (await focusedCall.boundingBox())!;
  const viewport = coworker.viewportSize()!;
  expect(callBounds.x).toBeGreaterThan(0);
  expect(callBounds.y).toBeGreaterThan(0);
  expect(callBounds.x + callBounds.width).toBeLessThan(viewport.width);
  expect(callBounds.y + callBounds.height).toBeLessThan(viewport.height);
  await expect
    .poll(async () => (await ownerTile.boundingBox())!.width)
    .toBeGreaterThan(compactBounds!.width * 2);
  expect(await video!.evaluate((element) => element.isConnected)).toBe(true);
  await expect
    .poll(() =>
      ownerTile.locator('video').evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  const callPosition = { ...coworkerPlayers.get(bob.id)! };
  await coworker.keyboard.press('ArrowLeft');
  await coworker.keyboard.press('Escape');
  await expect(focusedCall).toHaveCount(0);
  await expect(expand).toBeFocused();
  expect(coworkerPlayers.get(bob.id)!.x).toBe(callPosition.x);
  expect(await video!.evaluate((element) => element.isConnected)).toBe(true);
  await expand.click();
  await coworker.getByRole('button', { name: 'Back to map', exact: true }).click();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');

  // Stopping video unpublishes instead of muting, so the peer's tile goes away
  // and restarting republishes into that same one rather than adding a second.
  await page.getByRole('button', { name: 'Stop video', exact: true }).click();
  await expect(page.locator('.media-tile[data-local]')).toHaveCount(0);
  await expect(ownerTile).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await expect(ownerTile).toHaveCount(1, { timeout: 10_000 });
  await expect(ownerTile.locator('video')).toHaveCount(1);

  // Focus receives the conversation but reconnects with local microphone and
  // camera off. Either may then be enabled explicitly without changing status.
  await coworker.getByLabel('Availability').selectOption('focus');
  await expect(coworker.getByText('Focused · mic and video off')).toBeVisible();
  await expect(coworker.getByRole('button', { name: 'Mic', exact: true })).toBeEnabled();
  await expect(coworker.getByRole('button', { name: 'Video', exact: true })).toBeEnabled();
  await expect(coworker.locator(`.media-tile[data-participant="${owner.id}"] video`)).toHaveCount(
    1,
    { timeout: 10_000 },
  );
  await coworker.getByRole('button', { name: 'Mic', exact: true }).click();
  await coworker.getByRole('button', { name: 'Video', exact: true }).click();
  await expect(page.locator(`audio[data-participant="${bob.id}"]`)).toHaveCount(1, {
    timeout: 10_000,
  });
  await expect(page.locator(`.media-tile[data-participant="${bob.id}"] video`)).toHaveCount(1, {
    timeout: 10_000,
  });

  // DND disconnects from LiveKit, revokes the remote track and cannot obtain a
  // fresh credential even while the avatar remains in the call zone.
  await coworker.getByLabel('Availability').selectOption('do-not-disturb');
  await expect(coworker.getByText('Media off in DND')).toBeVisible();
  await expect(expand).toHaveCount(0);
  await expect(page.locator(`audio[data-participant="${bob.id}"]`)).toHaveCount(0, {
    timeout: 10_000,
  });
  expect((await (await coworker.request.get('/api/media/token')).json()).enabled).toBe(false);

  // Returning free reconnects. Leaving the zone then revokes the conversation.
  await coworker.getByLabel('Availability').selectOption('free');
  await expect(coworker.getByRole('button', { name: 'Stop video', exact: true })).toBeEnabled();
  await expect(coworker.locator(`.media-tile[data-participant="${owner.id}"] video`)).toHaveCount(
    1,
    {
      timeout: 10_000,
    },
  );
  await expect(page.locator(`.media-tile[data-participant="${bob.id}"] video`)).toHaveCount(1, {
    timeout: 10_000,
  });
  await coworker.keyboard.down('ArrowLeft');
  await expect.poll(() => coworkerPlayers.get(bob.id)?.zoneId).toBeNull();
  await coworkerPlayers.releaseKeys('ArrowLeft');
  await expect(coworker.getByText('Open floor is quiet')).toBeVisible();
  await expect(expand).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand call', exact: true })).toHaveCount(0);
  await expect(page.locator(`.media-tile[data-participant="${bob.id}"] video`)).toHaveCount(0, {
    timeout: 10_000,
  });

  // Outside the zone the credential itself is refused while the owner keeps
  // publishing inside it; cross-zone isolation is covered by the server tests.
  expect((await (await coworker.request.get('/api/media/token')).json()).enabled).toBe(false);

  // Holding one key per axis walks a diagonal; the facing stays on the axis it
  // was already showing.
  const bobStart = coworkerPlayers.get(bob.id)!;
  await coworker.keyboard.down('w');
  await coworker.keyboard.down('a');
  await expect.poll(() => ownerPlayers.get(bob.id)?.y).toBeLessThan(bobStart.y - 48);
  await expect.poll(() => ownerPlayers.get(bob.id)?.x).toBeLessThan(bobStart.x - 48);
  await coworkerPlayers.releaseKeys('w', 'a');
  await expect.poll(() => coworkerPlayers.get(bob.id)?.moving).toBe(false);
  expect(coworkerPlayers.get(bob.id)?.direction).toBe('left');
  await page.reload();
  await expect(page.getByTestId('connection')).toHaveText('2 here');
  await expect.poll(() => ownerPlayers.get(owner.id)?.x).toBe(saved.x);
  expect(ownerPlayers.get(owner.id)).toMatchObject({ displayName: 'Alice Oak', character: 3 });
  const duplicate = await page.context().newPage();
  await duplicate.goto('/');
  await expect(page.getByTestId('connection')).toHaveText('closed');
  await expect(duplicate.getByTestId('connection')).toHaveText('2 here');
  await duplicate.close();
  await coworkerContext.close();
  expect(errors).toEqual([]);
});
