import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const viteBinary = fileURLToPath(
  new URL(`./node_modules/.bin/vite${process.platform === 'win32' ? '.cmd' : ''}`, import.meta.url),
);
const consumerDirectory = fileURLToPath(new URL('.', import.meta.url));
const origin = 'http://127.0.0.1:4173';
let previewOutput = '';
const preview = spawn(
  viteBinary,
  ['preview', '--outDir', 'vite-dist', '--host', '127.0.0.1', '--port', '4173'],
  {
    cwd: consumerDirectory,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
preview.stdout.on('data', (chunk) => (previewOutput += chunk));
preview.stderr.on('data', (chunk) => (previewOutput += chunk));

async function waitForPreview() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) {
      throw new Error(`Vite preview exited early (${preview.exitCode}).\n${previewOutput}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for Vite preview.\n${previewOutput}`);
}

let browser;
try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  const dataRows = page.locator('tr.ant-table-row');
  await page.getByText('Zulu', { exact: true }).waitFor();
  assert.equal(await dataRows.count(), 2, 'The offset page size was not applied.');

  await dataRows.first().focus();
  await dataRows.first().press('Enter');
  assert.equal(await page.evaluate(() => window.__gridRowClicks), 1);

  const zuluRow = dataRows.first();
  await zuluRow.getByRole('button', { name: 'Edit Name' }).dblclick();
  const editor = zuluRow.locator('input').first();
  await editor.fill('Zulu edited');
  await editor.press('Enter');
  await page.waitForFunction(() => window.__gridSaves.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__gridSaves[0]), {
    rowKey: 'row-1',
    fieldId: 'name',
    value: 'Zulu edited',
    encodedValue: 'Zulu edited',
  });
  await page.getByText('Zulu edited', { exact: true }).waitFor();

  const search = page.getByPlaceholder('Search data');
  await search.fill('Mike');
  await search.press('Enter');
  await page.getByText('Mike', { exact: true }).waitFor();
  assert.equal(await dataRows.count(), 1, 'Search did not narrow the local data source.');
  await search.fill('');
  await search.press('Enter');
  await page.getByText('Zulu', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Sort' }).click();
  const sortPanel = page.locator('.hui-grid__sort-panel');
  await sortPanel.waitFor();
  await sortPanel.getByRole('button', { name: 'Add sort' }).click();
  await sortPanel.getByRole('button', { name: 'Apply' }).click();
  await page.getByText('Alpha', { exact: true }).waitFor();
  assert.match(
    (await dataRows.first().textContent()) ?? '',
    /Alpha/,
    'Applied ascending sort did not reorder the first page.',
  );

  await page.locator('.ant-pagination-item-2').click();
  await page.getByText('Mike', { exact: true }).waitFor();
  assert.match(
    (await dataRows.last().textContent()) ?? '',
    /Zulu/,
    'Offset pagination did not render the second sorted page.',
  );

  await page.getByRole('button', { name: /Sort/ }).click();
  await sortPanel.waitFor();
  await page.evaluate(() => window.__unmountGrid());
  await page.waitForFunction(() => document.getElementById('root')?.childElementCount === 0);
  await sortPanel.waitFor({ state: 'detached' });
} finally {
  await browser?.close();
  preview.kill('SIGTERM');
}
