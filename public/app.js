const $ = id => document.getElementById(id);
let state, activeFile = '', baseHash = '', original = '', editor, context, selectedProposal, running = false;
let opening = 0;
const node = (tag, value, cls) => {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (cls) element.className = cls;
  return element;
};
let toastTimer;
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500);
}
async function api(url, body) {
  const response = await fetch('/api/' + url, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cascade-Token': state.token }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const guard = fn => async event => { try { await fn(event); } catch (error) { toast(error.message); } };
const getValue = () => editor ? editor.getValue() : $('fallback-editor').value;
function dirty() {
  const changed = activeFile && getValue() !== original;
  $('dirty').textContent = changed ? '●' : '';
  $('save').disabled = !changed || running;
  return changed;
}
const language = file => ({ js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', json: 'json', css: 'css', html: 'html', md: 'markdown', py: 'python', rs: 'rust', go: 'go', yml: 'yaml', yaml: 'yaml' }[file.split('.').pop()] || 'plaintext');
async function openFile(file, force = false) {
  if (!force && dirty() && !confirm('Discard unsaved edits to ' + activeFile + '?')) return;
  const request = ++opening;
  const data = await api('file?path=' + encodeURIComponent(file));
  if (request !== opening) return;
  activeFile = file; baseHash = data.hash; original = data.content;
  $('empty-editor').hidden = true;
  if (editor) {
    $('monaco-editor').hidden = false;
    editor.setValue(data.content);
    monaco.editor.setModelLanguage(editor.getModel(), language(file));
    editor.layout();
  } else { $('fallback-editor').hidden = false; $('fallback-editor').value = data.content; }
  $('file-tab').textContent = file;
  $('file-info').textContent = language(file) + ' · UTF-8 · ' + data.content.split('\n').length + ' lines';
  dirty(); renderFiles();
}
function renderFiles() {
  const query = $('file-search').value.toLowerCase();
  $('files').replaceChildren();
  for (const file of state.files.filter(f => f.toLowerCase().includes(query))) {
    const button = node('button', undefined, file === activeFile ? 'selected' : '');
    button.append(node('span', '◇', 'file-symbol'), document.createTextNode(file));
    button.title = file; button.onclick = guard(() => openFile(file));
    $('files').append(button);
  }
}
function renderMemory() {
  $('task').value = state.task; $('summary').value = state.summary;
  $('decisions').replaceChildren();
  for (const decision of state.decisions) {
    const row = node('div'); const remove = node('button', '×');
    remove.setAttribute('aria-label', 'Remove decision: ' + decision);
    remove.onclick = guard(async () => { await api('memory', { removeDecision: decision }); await refresh(); renderMemory(); });
    row.append(node('span', decision), remove); $('decisions').append(row);
  }
  if (!state.decisions.length) $('decisions').append(node('p', 'No decisions yet. Add a constraint you want every model to remember.'));
}
function renderChat() {
  if (!state.messages.length) return;
  $('chat').replaceChildren();
  for (const message of state.messages) {
    const card = node('div', undefined, 'message ' + message.role);
    card.append(node('span', message.role === 'user' ? 'You' : 'Nova / ' + message.provider, 'author'), document.createTextNode(message.content));
    $('chat').append(card);
  }
  $('chat').scrollTop = $('chat').scrollHeight;
}
function selectTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  ['terminal', 'changes', 'activity'].forEach(name => $(name + '-pane').hidden = name !== tab);
}
function showProposal(proposal) {
  selectedProposal = proposal;
  $('diff-title').textContent = proposal.path;
  $('diff-reason').textContent = proposal.reason;
  $('diff-before').textContent = proposal.before ?? '(new file)';
  $('diff-after').textContent = proposal.content;
  $('accept').disabled = proposal.status !== 'pending';
  $('reject').disabled = proposal.status !== 'pending';
  $('diff-dialog').showModal();
}
function renderChanges() {
  $('changes-count').textContent = state.proposals.filter(p => p.status === 'pending').length;
  $('changes-pane').replaceChildren();
  for (const proposal of [...state.proposals].reverse()) {
    const row = node('div', undefined, 'change');
    const review = node('button', proposal.status === 'pending' ? 'Review' : 'View');
    review.onclick = () => showProposal(proposal);
    row.append(node('span', proposal.path), node('small', proposal.status), review);
    $('changes-pane').append(row);
  }
  if (!state.proposals.length) $('changes-pane').append(node('p', 'Agent changes appear here for review before they touch your files.'));
}
function renderActivity() {
  $('activity-pane').replaceChildren();
  for (const event of [...state.events].reverse()) {
    const row = node('div', undefined, 'event');
    row.append(node('time', new Date(event.time).toLocaleTimeString()), node('span', event.type + ' · ' + event.detail));
    $('activity-pane').append(row);
  }
}
function renderUsage() {
  const run = [...state.runs].reverse().find(r => r.context);
  if (run) {
    context = run.context;
    $('token-meter').textContent = run.inputTokens.toLocaleString() + ' in / ' + run.outputTokens.toLocaleString() + ' out';
    $('meter-fill').style.width = Math.min(100, run.context.inputTokens / run.context.budget * 100) + '%';
    $('usage-note').textContent = (run.estimated ? 'Estimated tokens' : 'Provider-reported tokens') + ' · costs use configured rates';
  }
  const known = state.runs.reduce((sum, r) => sum + (r.cost || 0), 0);
  const unknown = state.runs.some(r => r.cost == null);
  $('cost-meter').textContent = '$' + known.toFixed(4) + (unknown ? ' + unpriced' : ' session');
  $('footer-stats').textContent = state.files.length + ' files · ' + state.decisions.length + ' decisions · ' + state.runs.length + ' runs';
}
async function refresh() {
  const selected = $('provider').value || localStorage.getItem('cascade-provider');
  state = await api('state');
  $('workspace-name').textContent = state.name;
  $('repo-label').textContent = state.name;
  $('provider').replaceChildren();
  for (const provider of state.providers) {
    const option = node('option', provider.name + (provider.configured ? '' : ' · setup required'));
    option.value = provider.id; option.disabled = !provider.configured; $('provider').append(option);
  }
  if (state.providers.some(p => p.id === selected && p.configured)) $('provider').value = selected;
  renderFiles(); renderChat(); renderChanges(); renderActivity(); renderUsage();
}
function showContext() {
  $('composition').replaceChildren();
  if (context) {
    for (const [name, count] of Object.entries(context.composition)) {
      const card = node('div', name); card.append(node('b', count.toLocaleString())); $('composition').append(card);
    }
    $('context-caption').textContent = context.inputTokens.toLocaleString() + ' estimated input tokens / ' + context.budget.toLocaleString() + ' budget · ' + context.packet.files.length + ' relevant files. Raw conversation is not included. JSON overhead is included in the total.';
    $('context-json').textContent = JSON.stringify(context.packet, null, 2);
  }
  $('context-dialog').showModal();
}
async function save() {
  if (!activeFile || !dirty()) return;
  const file = activeFile;
  const content = getValue();
  const data = await api('file', { path: file, content, hash: baseHash });
  if (activeFile === file) { baseHash = data.hash; original = content; dirty(); }
  $('verification').textContent = 'Changes need verification';
  toast('File saved');
}
async function review(accept) {
  if (accept && selectedProposal.path === activeFile && dirty()) throw new Error('Save or discard your editor changes before accepting this proposal.');
  const proposal = await api('review', { id: selectedProposal.id, accept });
  $('diff-dialog').close(); await refresh();
  if (accept && proposal.path === activeFile) await openFile(activeFile, true);
  if (accept) $('verification').textContent = 'Changes need verification';
  toast(accept ? 'Change accepted. Run tests to verify it.' : 'Change rejected. Your file is unchanged.');
}
function setRunning(value) {
  running = value;
  $('run').disabled = value;
  $('run').textContent = value ? 'Working…' : 'Run agent ↑';
  $('session-detail').textContent = value ? 'Compiling context & waiting for provider' : 'Persistent memory · local storage';
  dirty();
}
$('save').onclick = guard(save);
$('file-search').oninput = renderFiles;
$('refresh').onclick = guard(refresh);
$('fallback-editor').oninput = dirty;
$('provider').onchange = () => {
  localStorage.setItem('cascade-provider', $('provider').value);
  toast('Provider selected. Workspace memory will be included in the next handoff.');
};
$('memory-button').onclick = () => { renderMemory(); $('memory-dialog').showModal(); };
document.querySelectorAll('.close').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => selectTab(button.dataset.tab));
document.querySelectorAll('[data-prompt]').forEach(button => button.onclick = () => { $('prompt').value = button.dataset.prompt; $('prompt').focus(); });
$('task-form').onsubmit = guard(async event => {
  event.preventDefault(); await api('memory', { task: $('task').value, summary: $('summary').value });
  await refresh(); toast('Workspace memory saved'); $('memory-dialog').close();
});
$('decision-form').onsubmit = guard(async event => {
  event.preventDefault(); await api('memory', { decision: $('decision').value.trim() }); $('decision').value = '';
  await refresh(); renderMemory();
});
$('preview-context').onclick = guard(async () => {
  context = await api('context', { prompt: $('prompt').value.trim() || state.task || 'Explore the repository', budget: Number($('budget').value), activeFile });
  showContext();
});
$('context-details').onclick = showContext;
$('prompt-form').onsubmit = guard(async event => {
  event.preventDefault();
  if (running) return;
  if (dirty()) throw new Error('Save your active file before running the agent so it sees your latest edits.');
  const prompt = $('prompt').value.trim();
  if (!prompt) return;
  setRunning(true);
  try {
    await api('run', { prompt, provider: $('provider').value, mode: $('mode').value, budget: Number($('budget').value), activeFile });
    $('prompt').value = ''; selectTab('changes'); toast('Agent finished. Review proposed changes below.');
  } finally { setRunning(false); await refresh(); }
});
$('command-form').onsubmit = guard(async event => {
  event.preventDefault();
  const command = $('command').value.trim() || 'git status';
  $('terminal-output').textContent += '\n\n❯ ' + command + '\nRunning…';
  const button = event.target.querySelector('button'); button.disabled = true;
  try {
    const result = await api('command', { command });
    $('terminal-output').textContent += '\n' + result.stdout + result.stderr + '\nExit: ' + result.exitCode;
    if (command === 'node --test') $('verification').textContent = 'Test command: exit ' + result.exitCode;
    await refresh();
  } finally { button.disabled = false; $('terminal-output').scrollTop = $('terminal-output').scrollHeight; }
});
$('accept').onclick = guard(() => review(true));
$('reject').onclick = guard(() => review(false));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); guard(save)(); }
});
window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
if (typeof window.require === 'function') {
  window.require.config({ paths: { vs: window.location.origin + '/monaco/vs' } });
  window.require(['vs/editor/editor.main'], () => {
    monaco.editor.defineTheme('cascade', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#111512', 'editorLineNumber.foreground': '#52604b', 'editor.lineHighlightBackground': '#1a2217' } });
    const value = $('fallback-editor').value;
    editor = monaco.editor.create($('monaco-editor'), { value, language: language(activeFile), theme: 'cascade', automaticLayout: true, minimap: { enabled: false }, fontSize: 13, fontFamily: 'Consolas, monospace', scrollBeyondLastLine: false, padding: { top: 18 }, wordWrap: 'on' });
    editor.onDidChangeModelContent(dirty);
    $('editor-engine').textContent = 'Monaco Editor';
    if (activeFile) { $('fallback-editor').hidden = true; $('monaco-editor').hidden = false; editor.layout(); }
  }, () => { $('editor-engine').textContent = 'Plain text editor · Monaco unavailable'; });
}
refresh().catch(error => toast(error.message));
