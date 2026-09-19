import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.cascade', 'browser-fixture');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'auth.js'), 'export function login() {\n  return false;\n}\n');
fs.writeFileSync(path.join(root, 'README.md'), '# Browser test workspace\nA sample authentication module.');
// Reset only known fixture files, leaving the actual workspace untouched.
for (const relative of ['cascade-note.md', '.cascade/state.json']) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Invalid fixture path');
  if (fs.existsSync(target)) fs.unlinkSync(target);
}
export default defineConfig({
  testDir: './e2e',
  outputDir: '.cascade/test-results',
  reporter: 'list',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4318', channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'node src/server.js',
    url: 'http://127.0.0.1:4318',
    reuseExistingServer: false,
    env: { PORT: '4318', CASCADE_WORKSPACE: root },
    timeout: 30000
  }
});

