# cascADE MVP

cascADE is a local, single-user coding workspace built from the MVP in the concept README. It keeps task state independent of the model and compiles a fresh portable handoff for every request.

## Run

Requires Node.js 22 or newer.

```powershell
npm install
npm start
```

Open http://127.0.0.1:4317. The default repository is the directory from which you start the server. Use the offline Demo provider to try context preview, generation, and accept/reject without credentials. Demo creates a workspace note; it does not perform AI coding.

To open another repository, set its absolute path before starting:

```powershell
$env:CASCADE_WORKSPACE = 'D:\projects\my-app'
npm start
```

Monaco is served locally from node_modules. If unavailable, an editable plain text fallback remains functional.

## Providers

Set environment variables in the server's shell and restart. Credentials never go to the browser. No .env loader is included; use shell variables or Node's --env-file option.

| Variable | Purpose |
| --- | --- |
| ANTHROPIC_API_KEY | Anthropic API credential |
| ANTHROPIC_MODEL | Your enabled Anthropic model ID; required |
| ANTHROPIC_CONTEXT | Model context limit; defaults to a conservative 32,000 |
| ANTHROPIC_INPUT_PRICE | Optional USD per million input tokens |
| ANTHROPIC_OUTPUT_PRICE | Optional USD per million output tokens |
| OLLAMA_MODEL | Installed Ollama model name; enables the adapter |
| OLLAMA_URL | Ollama server, default http://127.0.0.1:11434 |
| OLLAMA_CONTEXT | Available model context, default 16,000 |
| PORT | Local workspace port, default 4317 |

Get model names and rates from your account/provider; the app deliberately does not embed changing prices. Missing prices show as unpriced rather than zero. Ollama costs show zero API cost, excluding hardware and electricity.

The adapters follow the [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create) and [Ollama chat API](https://docs.ollama.com/api/chat).

Manual routing uses only the selected provider. Automatic routing tries the other configured real provider after rate/quota errors (HTTP 429), transient server errors, connection failures, or timeouts. It never silently falls back to Demo. Authentication and malformed-response errors stop the run. The context compiler reserves 4,096 tokens for output and recompiles for each provider's configured context capacity. Unknown provider context-limit errors are surfaced rather than blindly retried.

## Workflow

1. Open a file from the explorer, edit with Monaco, and save with Ctrl+S.
2. Add your objective and decisions in Workspace memory.
3. Select a provider and routing mode, enter a task, and preview Context.
4. Run the agent. Only the selected relevant files and compact memory are sent.
5. Review before/after contents under Changes and accept or reject each file.
6. Use the command runner to inspect Git or run tests.

The command runner supports exactly git status, git diff, and node --test. Tests execute repository code on your machine; this is not a sandbox or a full interactive shell. Git diff covers tracked, unstaged changes. New files are visible in status and the proposal review.

## Architecture

- src/core.js: workspace boundaries, file retrieval, bounded handoff compiler, persistent store, proposal validation and conflict detection.
- src/providers.js: provider adapters, normalized usage, and failover router.
- src/server.js: loopback HTTP server, authenticated mutations, file and memory APIs, orchestration, and command presets.
- public/: responsive IDE shell, Monaco integration, chat, memory editor, context inspection, activity history, usage, and change review.
- test/: backend unit and HTTP integration tests.
- e2e/: browser workflow verification against an isolated fixture.

State is stored atomically in the repository's .cascade/state.json. It contains raw conversations, task summaries, decisions, failure memory, activity events, run usage, handoff packets, and change proposals. This directory is private local data: exclude it from version control in any repository you open.

Retrieval ranks file paths and content by query terms and favors the active file and project manifests. It includes complete files only, avoiding unsafe edits based on truncated source. Indexing is capped at 2,000 paths, depth 12, 256 KB per text file and 12 files per handoff. Oversized optional context is omitted; mandatory task/decisions that exceed the budget produce an explicit error.

Token estimates use UTF-8 bytes / 3, rounded up. They are a heuristic, not model-specific tokenization. Reported provider usage replaces estimates after generation. Cost includes received responses even when proposal validation fails. Failed network attempts can have unknown charges, shown as unpriced.

Models propose complete file contents in a validated JSON response. No agent-generated command is executed. Proposals are staged locally, remain pending until reviewed, and use content hashes to reject stale writes. Concurrent runs and mutation requests are rejected while generation or a command is active. Acceptance is per file, not a multi-file transaction.

## Validation

```powershell
npm test
npm run check
npm run test:e2e
```

Browser tests use an installed Microsoft Edge by default. Set PLAYWRIGHT_CHANNEL=chrome for installed Chrome. Test fixtures and screenshots stay under .cascade. Provider API tests use mocked HTTP responses: live credentials and a running Ollama model are not required, and live model quality is not verified.

## Deliberate MVP boundaries

This implementation covers the README's initial ten-feature workflow. It does not claim the research roadmap is complete: semantic embeddings/graphs, model-side delta caching, context branches, replay/rollback, agent tournaments, smart learned routing, security review agents, marketplace, hard dollar budgets, live quota polling, and desktop/PTY execution are future work.

Summarization is the provider's explicit compact summary, editable by the user, rather than a separate summarizer call. Architectural decisions are included as instructions, not enforced by a static analyzer. Verification is actual command output, never an invented confidence percentage. Editing and external changes after a verification run may invalidate its result.

The server is intended for trusted local repositories and one local user. It binds only to 127.0.0.1, checks Host/Origin, protects writes with a per-process token, rejects traversal/symlinks and protected paths, and excludes common secret filenames. Filename filtering is not a general secret scanner: inspect context before sending sensitive code. State is not encrypted, and local processes can access the workspace.

