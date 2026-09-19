import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store, filesIn, safePath, readFile, hash, compileContext, parseResponse, stageChanges, reviewChange } from './core.js';
import { providersFromEnv, publicProviders, route } from './providers.js';

const exec = promisify(execFile);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = (value, name, max = 16000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(name + ' must contain 1–' + max + ' characters');
  return value;
};
async function bodyOf(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Request too large');
  }
  return JSON.parse(raw || '{}');
}
export function createApp({ root = process.env.CASCADE_WORKSPACE || process.cwd(), providers = providersFromEnv(), generateFn } = {}) {
  const store = new Store(root);
  const token = randomBytes(32).toString('hex');
  let busy = false;
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(data));
    };
    try {
      const address = server.address();
      const host = req.headers.host;
      const hosts = ['127.0.0.1:' + address.port, 'localhost:' + address.port];
      if (!hosts.includes(host)) return send(403, { error: 'Localhost access only' });
      const origin = req.headers.origin;
      if (origin && !hosts.map(h => 'http://' + h).includes(origin)) return send(403, { error: 'Cross-origin request blocked' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Cross-site request blocked' });
      const url = new URL(req.url, 'http://' + host);
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.headers['x-cascade-token'] !== token) return send(403, { error: 'Invalid session token. Reload the workspace.' });
        if (req.method === 'GET' && url.pathname === '/api/state') return send(200, {
          ...store.state, root: store.root, name: path.basename(store.root), files: filesIn(store.root), providers: publicProviders(providers), token, busy
        });
        if (req.method === 'GET' && url.pathname === '/api/file') {
          const content = readFile(store.root, url.searchParams.get('path'));
          return send(200, { content, hash: hash(content) });
        }
        if (req.method !== 'POST') return send(404, { error: 'Not found' });
        const body = await bodyOf(req);
        if (busy) return send(409, { error: 'An agent or command is running. Wait for it to finish.' });
        if (url.pathname === '/api/file') {
          const target = safePath(store.root, body.path);
          if (typeof body.content !== 'string' || Buffer.byteLength(body.content) > 256000) throw new Error('Invalid file content');
          const original = readFile(store.root, body.path);
          if (body.hash !== hash(original)) return send(409, { error: 'File changed on disk. Reload before saving.' });
          fs.writeFileSync(target, body.content, 'utf8');
          store.event('saved', body.path); store.save();
          return send(200, { hash: hash(body.content) });
        }
        if (url.pathname === '/api/memory') {
          // Validate all fields before mutating persisted memory.
          const task = body.task !== undefined ? text(body.task, 'Task', 4000) : store.state.task;
          if (body.summary !== undefined && (typeof body.summary !== 'string' || body.summary.length > 8000)) throw new Error('Summary exceeds 8,000 characters');
          const decision = body.decision !== undefined ? text(body.decision, 'Decision', 1000) : null;
          if (decision && !store.state.decisions.includes(decision) && store.state.decisions.length >= 50) throw new Error('Decision limit reached');
          store.state.task = task;
          if (body.summary !== undefined) store.state.summary = body.summary;
          if (decision && !store.state.decisions.includes(decision)) store.state.decisions.push(decision);
          if (body.removeDecision !== undefined) store.state.decisions = store.state.decisions.filter(d => d !== body.removeDecision);
          store.event('memory', 'Workspace memory updated'); store.save();
          return send(200, { ok: true });
        }
        if (url.pathname === '/api/context') return send(200, compileContext(store.root, store.state, text(body.prompt, 'Prompt'), body.budget ?? 8000, body.activeFile));
        if (url.pathname === '/api/review') {
          if (typeof body.accept !== 'boolean') throw new Error('Review action must be accept or reject');
          return send(200, reviewChange(store, body.id, body.accept));
        }
        if (url.pathname === '/api/run') {
          const prompt = text(body.prompt, 'Prompt');
          const budget = body.budget ?? 8000;
          if (!Number.isInteger(budget) || budget < 2000 || budget > 64000) throw new Error('Invalid context budget');
          busy = true;
          const runId = randomUUID();
          const started = Date.now();
          if (!store.state.task) store.state.task = prompt.slice(0, 4000);
          store.state.messages.push({ role: 'user', content: prompt, time: new Date().toISOString(), runId });
          store.event('started', body.provider + ': ' + prompt.slice(0, 120)); store.save();
          try {
            const { provider, context, result, attempts } = await route({ providers, selected: body.provider, mode: body.mode || 'manual',
              compile: limit => compileContext(store.root, store.state, prompt, Math.min(budget, limit), body.activeFile),
              onAttempt: (id, error) => store.event('provider_error', id + ': ' + error), generateFn
            });
            const knownPrice = [provider.inputPrice, provider.outputPrice].every(p => Number.isFinite(p) && p >= 0);
            const run = { id: runId, time: new Date().toISOString(), provider: provider.id, model: provider.model,
              inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.estimated,
              cost: knownPrice ? (result.inputTokens * provider.inputPrice + result.outputTokens * provider.outputPrice) / 1e6 : null,
              durationMs: Date.now() - started, context, attempts, status: 'received' };
            store.state.runs.push(run);
            // Account for a paid response even if its proposed edits are invalid.
            const parsed = parseResponse(result.text);
            const proposals = stageChanges(store.root, parsed.changes, context);
            store.state.proposals.push(...proposals.map(p => ({ ...p, runId })));
            store.state.summary = parsed.summary.slice(0, 8000);
            store.state.messages.push({ role: 'assistant', content: parsed.message, provider: provider.id, time: new Date().toISOString(), runId });
            run.status = 'proposed';
            store.event('completed', provider.name + ': ' + proposals.length + ' change(s) awaiting review; not verified'); store.save();
            return send(200, { run, proposals });
          } catch (error) {
            const run = store.state.runs.find(r => r.id === runId);
            if (run) { run.status = 'failed'; run.error = error.message; }
            else store.state.runs.push({ id: runId, time: new Date().toISOString(), provider: body.provider, status: 'failed', error: error.message, inputTokens: 0, outputTokens: 0, cost: null });
            store.state.failures.push({ task: prompt.slice(0, 500), error: error.message, time: new Date().toISOString() });
            store.state.failures = store.state.failures.slice(-50);
            store.event('failed', error.message); store.save();
            throw error;
          } finally { busy = false; }
        }
        if (url.pathname === '/api/command') {
          // User-triggered presets only. Never execute model-provided shell strings.
          const commands = {
            'git status': ['git', ['-c', 'safe.directory=' + store.root, 'status', '--short', '--branch']],
            'git diff': ['git', ['-c', 'safe.directory=' + store.root, 'diff', '--no-ext-diff', '--no-textconv']],
            'node --test': [process.execPath, ['--test']]
          };
          const command = Object.hasOwn(commands, body.command) ? commands[body.command] : null;
          if (!command) throw new Error('Supported commands: git status, git diff, node --test');
          busy = true;
          try {
            let result;
            try {
              const output = await exec(command[0], command[1], { cwd: store.root, timeout: 30000, maxBuffer: 1_000_000, windowsHide: true });
              result = { ...output, exitCode: 0 };
            } catch (error) { result = { stdout: error.stdout || '', stderr: error.stderr || error.message, exitCode: error.code ?? 1 }; }
            store.event('command', body.command + ' → exit ' + result.exitCode);
            if (result.exitCode !== 0) {
              store.state.failures.push({ task: body.command, error: result.stderr.slice(0, 2000) || result.stdout.slice(-2000), time: new Date().toISOString() });
              store.state.failures = store.state.failures.slice(-50);
            }
            store.save(); return send(200, result);
          } finally { busy = false; }
        }
        return send(404, { error: 'Not found' });
      }
      if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const assetRoot = relative.startsWith('/monaco/') ? path.join(appRoot, 'node_modules', 'monaco-editor', 'min') : path.join(appRoot, 'public');
      const assetPath = relative.startsWith('/monaco/') ? relative.slice('/monaco/'.length) : relative.slice(1);
      const file = path.resolve(assetRoot, assetPath);
      if (!file.startsWith(assetRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, { error: 'Not found' });
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'" });
      fs.createReadStream(file).pipe(res);
    } catch (error) { if (!res.headersSent) send(400, { error: error.message }); else res.end(); }
  });
  return { server, store };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApp();
  const port = Number(process.env.PORT || 4317);
  server.listen(port, '127.0.0.1', () => console.log('cascADE workspace: http://127.0.0.1:' + server.address().port));
}

