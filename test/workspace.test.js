import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, safePath, filesIn, compileContext, parseResponse, stageChanges, reviewChange, hash } from '../src/core.js';
import { route, generate, providersFromEnv, publicProviders } from '../src/providers.js';
import { createApp } from '../src/server.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-test-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('cascade-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'auth.js'), 'export const login = () => false;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Test project\nAuthentication service.');
  return root;
}
test('path protection covers traversal, secrets and Windows aliases', t => {
  const root = fixture(t);
  for (const file of ['../escape', '/etc/passwd', 'C:/file', '.git/config', '.GIT/config', '.git./config', '.env', '.env.local', 'key.pem', 'src\\file', 'file:stream', 'NUL.txt', 'src/../x', '.cascade/state.json']) {
    assert.throws(() => safePath(root, file), undefined, file);
  }
  assert.equal(safePath(root, 'src/auth.js'), path.join(root, 'src', 'auth.js'));
});
test('index omits secrets and generated directories', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, '.env'), 'DO_NOT_SEND=secret');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'dep.js'), 'ignore');
  assert.deepEqual(filesIn(root), ['auth.js', 'README.md']);
});
test('compact context retains decisions, ranks active file and enforces serialized budget', t => {
  const root = fixture(t);
  const { state } = new Store(root);
  state.decisions = ['Do not store tokens in localStorage'];
  state.messages = [{ role: 'user', content: 'RAW_HISTORY_MUST_NOT_APPEAR'.repeat(10000) }];
  state.summary = 'Login currently fails; investigate auth.js';
  fs.writeFileSync(path.join(root, 'huge.js'), 'x'.repeat(100000));
  const result = compileContext(root, state, 'Fix login', 2000, 'auth.js');
  assert.ok(result.inputTokens <= 2000);
  assert.equal(result.packet.files[0].path, 'auth.js');
  assert.ok(!JSON.stringify(result).includes('RAW_HISTORY_MUST_NOT_APPEAR'));
  assert.deepEqual(result.packet.decisions, state.decisions);
  assert.ok(!result.packet.files.some(f => f.path === 'huge.js'));
  state.decisions = ['x'.repeat(20000)];
  assert.throws(() => compileContext(root, state, 'fix', 2000), /exceed/);
});
test('memory and full conversation survive a restart', t => {
  const root = fixture(t);
  const store = new Store(root);
  store.state.task = 'Fix auth';
  store.state.decisions.push('Use server sessions');
  store.state.messages.push({ role: 'user', content: 'Persist this' });
  store.save();
  assert.deepEqual(new Store(root).state, store.state);
});
test('proposals do not write until accepted, and stale changes are rejected', t => {
  const root = fixture(t);
  const store = new Store(root);
  const context = compileContext(root, store.state, 'Fix auth', 4000);
  const content = 'export const login = () => true;\n';
  const [proposal] = stageChanges(root, [{ path: 'auth.js', content, reason: 'Fix return' }], context);
  store.state.proposals.push(proposal);
  assert.notEqual(fs.readFileSync(path.join(root, 'auth.js'), 'utf8'), content);
  fs.writeFileSync(path.join(root, 'auth.js'), '// user edit');
  assert.throws(() => reviewChange(store, proposal.id, true), /changed since/);
  assert.equal(fs.readFileSync(path.join(root, 'auth.js'), 'utf8'), '// user edit');
  reviewChange(store, proposal.id, false);
  assert.equal(proposal.status, 'rejected');
  const [fresh] = stageChanges(root, [{ path: 'src/new.js', content, reason: 'New file' }], context);
  store.state.proposals.push(fresh); reviewChange(store, fresh.id, true);
  assert.equal(fs.readFileSync(path.join(root, 'src/new.js'), 'utf8'), content);
});
test('staging rejects unread files and validates all changes before persistence', t => {
  const root = fixture(t);
  const context = compileContext(root, new Store(root).state, 'auth', 3000);
  assert.throws(() => stageChanges(root, [{ path: '.env', content: '', reason: '' }], context), /Protected/);
  fs.writeFileSync(path.join(root, 'other.js'), 'not supplied');
  assert.throws(() => stageChanges(root, [{ path: 'other.js', content: '', reason: '' }], context), /unread/);
  assert.throws(() => parseResponse('Not JSON'), /invalid JSON/);
  assert.throws(() => parseResponse(JSON.stringify({ message: '', summary: '', changes: [{ path: 'x', content: '', reason: '' }, { path: 'X', content: '', reason: '' }] })), /duplicate/);
});
test('automatic fallback carries the same memory and never silently uses demo', async () => {
  const providers = [
    { id: 'a', configured: true, maxContext: 16000 },
    { id: 'b', configured: true, maxContext: 12000 },
    { id: 'demo', configured: true, maxContext: 16000 }
  ];
  const calls = [];
  const output = await route({ providers, selected: 'a', mode: 'automatic', compile: limit => ({ limit, task: 'Keep session', decisions: ['JWT'] }),
    generateFn: async (p, context) => {
      calls.push({ id: p.id, context });
      if (p.id === 'a') throw Object.assign(new Error('quota exhausted'), { retryable: true });
      return { text: 'ok' };
    }
  });
  assert.equal(output.provider.id, 'b');
  assert.deepEqual(calls.map(c => c.id), ['a', 'b']);
  assert.deepEqual(calls[0].context.decisions, calls[1].context.decisions);
  assert.equal(calls[1].context.limit, 12000 - 4096);
  await assert.rejects(route({ providers, selected: 'a', mode: 'manual', compile: () => ({}), generateFn: async () => { throw Object.assign(new Error('429'), { retryable: true }); } }), /All eligible/);
});
test('authentication errors do not trigger fallback', async () => {
  let attempts = 0;
  await assert.rejects(route({ providers: [{ id: 'a', configured: true, maxContext: 12000 }, { id: 'b', configured: true, maxContext: 12000 }], selected: 'a', mode: 'automatic', compile: () => ({}), generateFn: async () => { attempts++; throw new Error('401'); } }), /401/);
  assert.equal(attempts, 1);
});
test('Anthropic and Ollama adapters send proper envelopes and read usage', async () => {
  const providers = providersFromEnv({ ANTHROPIC_MODEL: 'test-model', ANTHROPIC_API_KEY: 'test-key', OLLAMA_MODEL: 'test-local' });
  assert.ok(!JSON.stringify(publicProviders(providers)).includes('test-key'));
  const context = { packet: { task: 'Fix auth' }, inputTokens: 100 };
  for (const provider of providers.filter(p => p.id !== 'demo')) {
    const result = await generate(provider, context, async (url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.model, provider.model);
      if (provider.id === 'anthropic') {
        assert.equal(request.headers['x-api-key'], 'test-key');
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 23, output_tokens: 7 } }) };
      }
      assert.equal(body.stream, false);
      assert.equal(body.options.num_predict, 4096);
      return { ok: true, json: async () => ({ message: { content: '{}' }, prompt_eval_count: 23, eval_count: 7 }) };
    });
    assert.equal(result.inputTokens, 23); assert.equal(result.outputTokens, 7); assert.equal(result.estimated, false);
  }
});
async function runningApp(t, options = {}) {
  const root = fixture(t);
  const app = createApp({ root, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const state = await (await fetch(url + '/api/state')).json();
  const post = async (endpoint, body, headers = {}) => {
    const response = await fetch(url + '/api/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cascade-Token': state.token, ...headers }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { ...app, url, post, root };
}
test('HTTP end-to-end: memory → context → run → accept → restart', async t => {
  const { root, post, url } = await runningApp(t);
  assert.equal((await post('memory', { decision: 'Keep existing APIs stable' })).status, 200);
  const preview = await post('context', { prompt: 'Document auth', budget: 4000 });
  assert.ok(preview.data.packet.decisions.includes('Keep existing APIs stable'));
  const run = await post('run', { prompt: 'Document auth', provider: 'demo', mode: 'manual', budget: 4000 });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(fs.existsSync(path.join(root, 'cascade-note.md')), false);
  assert.equal((await post('review', { id: run.data.proposals[0].id, accept: true })).status, 200);
  assert.ok(fs.readFileSync(path.join(root, 'cascade-note.md'), 'utf8').includes('Keep existing APIs stable'));
  assert.equal(new Store(root).state.runs.length, 1);
  const file = await (await fetch(url + '/api/file?path=auth.js')).json();
  assert.equal((await post('file', { path: 'auth.js', hash: file.hash, content: '// saved' })).status, 200);
  assert.equal((await post('file', { path: 'auth.js', hash: file.hash, content: '// stale' })).status, 409);
  assert.equal(hash('// saved'), (await (await fetch(url + '/api/file?path=auth.js')).json()).hash);
});
test('HTTP blocks cross-origin writes, invalid tokens, paths, and arbitrary commands', async t => {
  const { post } = await runningApp(t);
  assert.equal((await post('memory', { decision: 'bad' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('memory', { decision: 'bad' }, { 'X-Cascade-Token': 'wrong' })).status, 403);
  assert.equal((await post('file', { path: '../escape', content: 'bad' })).status, 400);
  assert.equal((await post('command', { command: 'git status; echo bad' })).status, 400);
});
test('invalid paid responses are accounted and recorded as failures', async t => {
  const { post, store } = await runningApp(t, {
    providers: [{ id: 'paid', configured: true, name: 'Paid', model: 'test', maxContext: 12000, inputPrice: 1, outputPrice: 2 }],
    generateFn: async () => ({ text: 'invalid', inputTokens: 100, outputTokens: 20, estimated: false })
  });
  const result = await post('run', { prompt: 'Fix auth', provider: 'paid', budget: 4000 });
  assert.equal(result.status, 400);
  assert.equal(store.state.runs[0].status, 'failed');
  assert.equal(store.state.runs[0].cost, 0.00014);
  assert.equal(store.state.proposals.length, 0);
  assert.equal(store.state.failures.length, 1);
});

