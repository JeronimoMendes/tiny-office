import { expect, test, type WebSocketRoute } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PROTOCOL_VERSION, type Member } from '@office/shared';

// Browser-only fixture: never claims or changes the running office.
test('compact status popover supports fuzzy emoji search, dismissal, saving and clearing', async ({
  page,
}, testInfo) => {
  const user: Member = {
    id: 'status-preview',
    displayName: 'Robin',
    email: 'robin@example.test',
    character: 0,
    role: 'member',
    status: 'focus',
  };
  const workspace = {
    id: 'preview',
    name: 'Tiny Office',
    mapRevision: 'preview',
    map: JSON.parse(await readFile('maps/office.tmj', 'utf8')),
    desks: {},
  };
  const movementHeadings: string[] = [];
  async function expectMovement(key: string, heading: string) {
    await expect(page.locator('.map-stage')).toBeFocused();
    movementHeadings.length = 0;
    await page.keyboard.down(key);
    try {
      await expect.poll(() => movementHeadings).toContain(heading);
    } finally {
      await page.keyboard.up(key);
    }
  }
  let socket: WebSocketRoute;
  let failSave = false;
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/custom-status')) {
      if (failSave) return route.fulfill({ status: 500, json: { error: 'Please try again.' } });
      const value = route.request().postDataJSON();
      user.customStatus = value.text ? value : null;
      socket.send(JSON.stringify({ type: 'members', members: [user], desks: {} }));
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: path.endsWith('/bootstrap')
        ? { required: false }
        : path.endsWith('/session')
          ? { user, members: [user], workspace }
          : { enabled: false },
    });
  });
  await page.routeWebSocket('**/ws', (connection) => {
    socket = connection;
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'input') return;
      if (message.heading) movementHeadings.push(message.heading);
      socket.send(
        JSON.stringify({
          type: 'delta',
          tick: message.seq,
          ack: message.seq,
          changedPlayers: [],
          removedPlayerIds: [],
        }),
      );
    });
    socket.send(
      JSON.stringify({
        type: 'welcome',
        version: PROTOCOL_VERSION,
        selfId: user.id,
        tick: 0,
        members: [user],
        workspace,
        players: [{ ...user, x: 480, y: 490, direction: 'down', moving: false, zoneId: null }],
      }),
    );
  });
  await page.goto('/');
  await expect(page.getByTestId('connection')).toHaveText('1 here');
  const trigger = page.getByRole('button', { name: 'Set custom status', exact: true });
  await expect(trigger).not.toContainText('Set');
  await expect(trigger.locator('svg')).toHaveCount(1);
  await trigger.click();
  const popover = page.getByRole('dialog', { name: 'Custom status', exact: true });
  await expect(popover).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.getByLabel('What are you working on?').fill('Taking a coffee break');
  await page.getByRole('button', { name: 'Choose status emoji' }).click();
  await expect(page.getByRole('button', { name: /Show more/ })).toBeVisible();
  await page.getByRole('button', { name: /Show more/ }).click();
  await expect(page.locator('.status-emoji-grid button')).toHaveCount(281);
  await page.getByRole('searchbox', { name: 'Search emojis' }).fill('hedgehog');
  await expect(page.getByRole('button', { name: 'hedgehog', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search emojis' }).fill('cofee');
  await expect(page.getByRole('button', { name: 'Coffee', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('emoji-picker.png') });
  await page.getByRole('button', { name: 'Coffee', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  failSave = true;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popover.getByRole('alert')).toHaveText('Please try again.');
  failSave = false;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popover).toHaveCount(0);
  await expectMovement('d', 'right');
  await expect(page.getByTestId(`person-${user.id}`)).toContainText('☕ Taking a coffee break');
  await expect(page.getByLabel('Availability')).toHaveValue('focus');
  const edit = page.getByRole('button', {
    name: 'Edit custom status: Taking a coffee break',
    exact: true,
  });
  expect(await edit.evaluate((element) => getComputedStyle(element, '::after').content)).toBe(
    'none',
  );
  await edit.click();
  await page.getByRole('button', { name: 'Choose status emoji' }).click();
  await page.getByRole('searchbox').fill('zzzzzz');
  await expect(page.getByText('No emojis found. Try another word.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose status emoji' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(edit).toBeFocused();
  await edit.click();
  await page.getByLabel('What are you working on?').fill('Unsaved');
  await page.getByRole('heading', { name: 'People' }).click();
  await expect(popover).toHaveCount(0);
  await edit.click();
  await expect(page.getByLabel('What are you working on?')).toHaveValue('Taking a coffee break');
  await page.getByRole('button', { name: 'Choose status emoji' }).click();
  await page.getByRole('searchbox').fill('coding');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Choose status emoji' })).toContainText('💻');
  await expect(popover).toBeVisible();
  await page.getByRole('button', { name: 'Choose status emoji' }).click();
  await page.getByRole('button', { name: 'Remove emoji', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).toBeVisible();
  expect(user.customStatus?.emoji).toBeNull();
  await edit.click();
  await page.getByRole('button', { name: 'Clear status', exact: true }).click();
  await expect(trigger).toBeVisible();
  await expectMovement('ArrowLeft', 'left');
  await expect(page.getByTestId(`person-${user.id}`)).not.toContainText('Taking a coffee break');
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await page.getByRole('button', { name: 'Choose status emoji' }).click();
  const bounds = await popover.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('emoji-picker-mobile.png') });
});
