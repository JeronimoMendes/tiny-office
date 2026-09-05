import { expect, test, type Page } from '@playwright/test';
import type { Player, ServerMessage, SessionInfo } from '@office/shared';

function observePlayers(page: Page) {
  const players = new Map<string, Player>();
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(payload.toString()) as ServerMessage;
      if (message.type === 'welcome') {
        players.clear();
        for (const p of message.players) players.set(p.id, p);
      }
      if (message.type === 'delta') {
        for (const id of message.removedPlayerIds) players.delete(id);
        for (const p of message.changedPlayers) players.set(p.id, p);
      }
    }),
  );
  return players;
}

test('owner invites a coworker, both move, profile/desks persist and reconnect restores position', async ({
  page,
  browser,
  baseURL,
}) => {
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
  await page.getByRole('button', { name: 'Character 4', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(coworker.getByTestId(`person-${owner.id}`)).toContainText('Alice Oak');

  const start = ownerPlayers.get(owner.id)!;
  await page.locator('.map-stage').click({ position: { x: 600, y: 450 } });
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => coworkerPlayers.get(owner.id)?.x).toBeGreaterThan(start.x + 48);
  await page.keyboard.up('ArrowRight');
  await expect.poll(() => ownerPlayers.get(owner.id)?.moving).toBe(false);
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => coworkerPlayers.get(owner.id)?.zoneId).toBe('desk-7');
  await page.keyboard.up('ArrowRight');
  await expect.poll(() => ownerPlayers.get(owner.id)?.moving).toBe(false);
  await expect(coworker.getByTestId(`person-${owner.id}`)).toContainText('Desk 7');
  const saved = { ...ownerPlayers.get(owner.id)! };
  expect(saved.y).toBe(start.y);

  const bobStart = coworkerPlayers.get(bob.id)!;
  await coworker.locator('.map-stage').click({ position: { x: 600, y: 450 } });
  await coworker.keyboard.down('w');
  await expect.poll(() => ownerPlayers.get(bob.id)?.y).toBeLessThan(bobStart.y - 48);
  await coworker.keyboard.up('w');
  await expect.poll(() => coworkerPlayers.get(bob.id)?.moving).toBe(false);
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
