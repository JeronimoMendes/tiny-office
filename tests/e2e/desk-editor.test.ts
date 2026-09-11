import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { TiledMap } from '@office/shared';
const itemProperty = (
  item: NonNullable<TiledMap['layers'][number]['objects']>[number],
  name: string,
) => item.properties.find((p) => p.name === name)?.value;

// UI-only coverage: no bootstrap, desk claim, database write or live session.
test('desk editor layers, covered-item selection and collision preview', async ({ page }) => {
  const map = JSON.parse(readFileSync('maps/office.tmj', 'utf8')) as TiledMap;
  const desk = map.layers
    .find((l) => l.name === 'zones')!
    .objects!.find((o) => itemProperty(o, 'kind') === 'desk')!;
  map.layers
    .find((l) => l.name === 'decor')!
    .objects!.push({
      id: 999999,
      name: 'Test rug',
      x: desk.x + 8,
      y: desk.y + 8,
      width: 64,
      height: 64,
      rotation: 0,
      properties: [{ name: 'sprite', value: 'cat-rug' }],
    });
  const workspace = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Test office',
    map,
    mapRevision: 'a'.repeat(64),
    desks: { [String(itemProperty(desk, 'zoneId'))]: 'tester' },
  };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        workspace,
        user: { id: 'tester', role: 'member', displayName: 'Tester' },
        members: [],
      },
    }),
  );
  await page.route('**/assets/**', (route) =>
    route.fulfill({ path: new URL(route.request().url()).pathname.slice(1) }),
  );
  let saved: TiledMap | undefined;
  await page.route('**/api/desks/mine/map', async (route) => {
    saved = route.request().postDataJSON().map;
    await route.fulfill({ json: { workspace: { ...workspace, map: saved } } });
  });
  await page.goto('/desk');
  await page
    .getByLabel('Select item (including covered items)')
    .selectOption({ label: 'Test rug · #999999' });
  await expect(page.getByLabel('Render layer')).toHaveValue('ground');
  await page.getByLabel('Show collision footprints').check();
  await expect(page.getByLabel('Facing / artwork')).toBeDisabled();
  await page.getByLabel('Angle (degrees)').fill('90');
  await page.getByLabel('Render layer').selectOption('furniture');
  await page.getByLabel('Priority within layer').fill('12');
  await page.getByRole('button', { name: 'Save desk', exact: true }).click();
  await expect(
    page.getByText('Saved. Everyone in the office is reloading the updated map.'),
  ).toBeVisible();
  const rug = saved!.layers.find((l) => l.name === 'decor')!.objects!.find((o) => o.id === 999999)!;
  expect(rug.rotation).toBe(90);
  expect(itemProperty(rug, 'renderLayer')).toBe('furniture');
  expect(itemProperty(rug, 'renderOrder')).toBe(12);
  expect(errors).toEqual([]);
});
