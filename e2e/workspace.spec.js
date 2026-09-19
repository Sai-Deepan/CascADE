import { test, expect } from '@playwright/test';

test('editor, persistent memory, context preview, proposal review and terminal', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Keep building. Keep your context.' })).toBeVisible();
  await page.getByRole('button', { name: '◇auth.js', exact: true }).click();
  await expect(page.locator('#editor-engine')).toHaveText('Monaco Editor');
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await page.locator('.monaco-editor textarea').first().focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.insertText('// browser edit\n');
  await page.getByRole('button', { name: 'Save Ctrl S' }).click();
  await expect(page.locator('#dirty')).toBeEmpty();

  await page.getByRole('button', { name: 'Workspace memory' }).click();
  await page.getByLabel('New decision').fill('Keep APIs stable');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('#decisions')).toContainText('Keep APIs stable');
  await page.getByLabel('Current objective').fill('Document authentication');
  await page.getByRole('button', { name: 'Save memory' }).click();
  await expect(page.locator('#memory-dialog')).not.toBeVisible();

  await page.getByLabel('Ask Nova').fill('Document the authentication module');
  await expect(page.locator('#prompt')).toHaveValue('Document the authentication module');
  await page.getByRole('button', { name: '⌘ Context' }).click();
  await expect(page.locator('#context-json')).toContainText('Keep APIs stable');
  await expect(page.locator('#context-json')).toContainText('browser edit');
  await page.locator('#context-dialog .close').click();
  await expect(page.locator('#context-dialog')).not.toBeVisible();
  await expect(page.locator('#prompt')).toHaveValue('Document the authentication module');
  await page.getByRole('button', { name: 'Run agent' }).click();
  await expect(page.locator('#chat')).toContainText('Offline demo:');
  await expect(page.locator('#changes-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.locator('#diff-after')).toContainText('Keep APIs stable');
  await page.getByRole('button', { name: 'Accept change', exact: true }).click();
  await expect(page.locator('#changes-count')).toHaveText('0');
  await page.getByRole('button', { name: '◇cascade-note.md', exact: true }).click();
  await expect(page.locator('#file-tab')).toHaveText('cascade-note.md');

  await page.reload();
  await expect(page.locator('#chat')).toContainText('Offline demo:');
  await page.getByRole('button', { name: 'Workspace memory' }).click();
  await expect(page.locator('#decisions')).toContainText('Keep APIs stable');
  await page.locator('#memory-dialog .close').click();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByLabel('Terminal command').fill('node --test');
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(page.locator('#terminal-output')).toContainText('Exit: 0');
  await page.screenshot({ path: '.cascade/workspace-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Run agent' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
