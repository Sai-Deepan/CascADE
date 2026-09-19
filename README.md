# cascADE

A local coding workspace that preserves task context across AI model switches.

## Run the implemented MVP

New here? Follow the [startup and user guide](STARTUP.md) to launch the app, try the demo, and connect a model.

Requires Node.js 22+. Run `npm install`, then `npm start`, and open **http://127.0.0.1:4317**.

Includes a Monaco editor, repository explorer, persistent task/decision memory, compact handoff previews, Anthropic and Ollama adapters, automatic fallback, token/cost accounting, a command runner, and accept/reject file proposals. The offline demo works without API credentials.

See [setup, configuration, architecture, and MVP boundaries](docs/IMPLEMENTATION.md). Run `npm test` and `npm run check` for backend validation, or `npm run test:e2e` for the browser workflow.

---

## Original concept and research roadmap

The core abstraction:

**User → Workspace → Persistent Context Layer → Agent Router → Any AI Model**

So Claude, GPT, Gemini, local models, etc. become replaceable compute. Your product owns the memory, context, repository understanding, token accounting, and execution environment.

rough architecture:

```text
┌──────────────────────────────────────────────┐
│                AI Development IDE            │
├──────────────────────────────────────────────┤
│ Editor │ Terminal │ Git │ Preview │ AI Chat │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│              Agent Orchestrator              │
│                                              │
│ Agent Router                                 │
│ Provider Adapter Layer                       │
│ Rate/Quota Manager                           │
│ Token Budget Manager                         │
│ Failover / Model Switching                   │
└──────────────────────┬───────────────────────┘
                       │
       ┌───────────────┴────────────────┐
       ▼                                ▼
┌─────────────────┐             ┌──────────────────┐
│ Persistent      │             │ Execution Layer  │
│ Context Engine  │             │                  │
│                 │             │ Shell            │
│ Conversation    │             │ Tests            │
│ Decisions       │             │ Compiler         │
│ File summaries  │             │ Sandbox          │
│ Project map     │             │ Browser/Preview  │
│ Embeddings      │             │ Git              │
└─────────────────┘             └──────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│           Model / Agent Providers            │
│ GPT │ Claude │ Gemini │ Grok │ Local │ etc. │
└──────────────────────────────────────────────┘
```

Your biggest technical insight is this: **do not pass the entire previous conversation to the next agent.** That will destroy the token-saving advantage.

Instead maintain several layers of memory.

```text
Workspace Memory
│
├── Project Manifest
│   ├── framework
│   ├── dependencies
│   ├── commands
│   └── repo structure
│
├── Architectural Memory
│   ├── auth uses JWT
│   ├── DB = PostgreSQL
│   ├── frontend = Next.js
│   └── API conventions
│
├── Decision Log
│   ├── "Use Redis for sessions"
│   ├── "Do not modify /legacy"
│   └── "Tests use pytest"
│
├── Task Memory
│   ├── current objective
│   ├── completed work
│   ├── failures
│   └── next steps
│
├── Code Intelligence
│   ├── symbols
│   ├── dependencies
│   ├── relevant files
│   └── embeddings
│
└── Raw Conversation
    └── stored, but rarely injected entirely
```

Before every prompt, your context engine builds a compact package:

```text
SYSTEM INSTRUCTIONS

CURRENT TASK
Fix authentication redirect loop.

PROJECT SUMMARY
Next.js + FastAPI + PostgreSQL.

RELEVANT DECISIONS
- Authentication uses JWT.
- Refresh token stored in HttpOnly cookie.

RELEVANT FILES
/auth/login.ts
/auth/middleware.ts
/api/auth.py

RECENT ACTIONS
Agent modified middleware.ts.
Tests currently fail in auth.test.ts.

USER REQUEST
"Fix the failing authentication flow."
```

That could be 3–8k tokens instead of dragging along a 100k-token chat.

This becomes extremely important when the provider changes.

Imagine:

```text
Claude Sonnet
Token quota exhausted
      ↓
Agent router
      ↓
GPT-5.6
```

GPT shouldn't need Claude's raw 80-message transcript. It receives a **handoff packet**.

For example:

```json
{
  "task": "Implement OAuth callback",
  "status": "partially_complete",
  "completed": [
    "Added /auth/google endpoint",
    "Created OAuth client"
  ],
  "remaining": [
    "Handle callback",
    "Store session",
    "Add tests"
  ],
  "important_files": [
    "auth/google.ts",
    "auth/session.ts"
  ],
  "decisions": [
    "Use server-side sessions",
    "Do not store OAuth token in localStorage"
  ],
  "errors": [
    "callback currently returns 401"
  ]
}
```

Now the second agent can continue almost immediately.

I would also make **token economics visible**, because developers currently have very poor visibility into what agents are spending.

Your UI could show:

```text
AI SESSION

GPT-5.6
Context        31,420 / 128,000
Input tokens       8,210
Output tokens      2,440

Estimated cost      $0.14
Session cost        $1.82

Provider quota
████████████████░░░░ 81%

Auto-switch at 95%
Next: Claude Sonnet
```

But go further than token usage. Show **where tokens are being spent**:

```text
Context composition

Repository context        4,220
Conversation summary      1,120
Current files             2,180
System instructions         540
User request                320
Git history                 470
──────────────────────────────
Total                     8,850
```

That feature alone could appeal heavily to power users.

You should also support three switching modes:

```text
Manual
User selects model.

Automatic
Switch when quota/rate limit/context limit hits.

Smart Routing
Model selected per task.
```

Smart routing is where the product becomes much more interesting.

For example:

```text
Task                     Agent

Autocomplete             Cheap fast model
UI generation            Gemini / Claude
Complex debugging        GPT / Claude
Repository search        Small local model
Documentation            Cheap model
Security review          Strong reasoning model
Tests                    Coding model
Code summarization       Local model
```

Then a development session might automatically become:

```text
User:
"Add Stripe subscriptions."

Planner
        ↓
Architecture Agent
        ↓
Coding Agent
        ↓
Testing Agent
        ↓
Security Agent
        ↓
Documentation Agent
```

Each agent reads/writes the same shared project memory.

That is much stronger than a chatbot embedded in VS Code.

I would design your internal provider interface something like:

```ts
interface AgentProvider {
    id: string;

    maxContext: number;

    generate(
        context: AgentContext,
        tools: ToolDefinition[]
    ): Promise<AgentResponse>;

    estimateTokens(
        context: AgentContext
    ): Promise<number>;

    getQuota(): Promise<QuotaState>;
}
```

Then adapters:

```text
providers/
    openai.ts
    anthropic.ts
    google.ts
    xai.ts
    ollama.ts
    openrouter.ts
```

Your orchestrator doesn't care which model it talks to.

Another critical component is the **context compiler**.

Instead of:

```python
context = entire_chat_history
```

do:

```python
context = (
    system_prompt
    + workspace_summary
    + task_summary
    + retrieve_relevant_files(prompt)
    + retrieve_relevant_decisions(prompt)
    + recent_actions
    + user_prompt
)
```

You can use a token budget:

```python
TOKEN_BUDGET = 32000

allocation = {
    "system": 2000,
    "task": 3000,
    "project_memory": 4000,
    "retrieved_code": 15000,
    "recent_history": 5000,
    "reserve_output": 3000
}
```

When a section exceeds its budget, summarize or rank it.

You can even introduce **context deduplication**. If the agent already knows:

```text
React 19
Next.js 15
PostgreSQL
Prisma
```

don't repeatedly inject 500 lines of `package.json` and architecture notes.

Store facts as normalized memory objects.

```json
{
    "type": "architecture",
    "key": "database",
    "value": "PostgreSQL",
    "confidence": 1,
    "source": "package.json"
}
```

There's another feature I'd seriously consider:

**Context branches.**

Suppose the developer tries three approaches:

```text
main context
   │
   ├── approach-A
   │     Claude
   │
   ├── approach-B
   │     GPT
   │
   └── approach-C
         Gemini
```

Then compare:

```text
Tests passed
Performance
Files changed
Token usage
Cost
```

That turns multiple agents into actual engineering experimentation rather than simple fallback.

For your MVP, though, do not build 20 agents.

Build these first:

1. Monaco editor + terminal + file tree.
2. One repository workspace.
3. Two model providers.
4. Persistent conversation/task state.
5. Context summarization.
6. Relevant-file retrieval.
7. Manual agent switching.
8. Automatic quota/rate-limit fallback.
9. Token and cost meter.
10. Git diff + accept/reject AI changes.

The initial UX could be extremely simple:

```text
┌───────────────┬──────────────────────┬─────────────────────┐
│ FILES         │ EDITOR               │ AI AGENT            │
│               │                      │                     │
│ src/          │ auth.ts              │ GPT-5.6 ▾           │
│ ├ auth.ts     │                      │                     │
│ ├ api.ts      │ function login()...  │ Fix the login bug   │
│ └ app.ts      │                      │                     │
│               │                      │                     │
│               │                      │ Context: 14.2k      │
│               │                      │ Cost: $0.04         │
│               │                      │                     │
│               │                      │ [Run Agent]         │
├───────────────┴──────────────────────┼─────────────────────┤
│ TERMINAL                             │ Agent Activity      │
│ $ npm test                           │ Read auth.ts        │
│                                     │ Modified api.ts     │
│                                     │ Running tests...    │
└─────────────────────────────────────┴─────────────────────┘
```

And I would position the product around one sentence:

> **Switch AI models without losing your development context.**

Or stronger:

> **One coding workspace. Every AI model. Zero context resets.**

The second is probably closer to the product you're describing.

The long-term moat isn't model access. Anyone can call APIs. Your moat would be the **developer context graph**: understanding how files, prompts, decisions, bugs, commits, commands, and agent actions relate over the entire lifetime of a project.

### 1. Agent Handoff Protocol — highest priority

Treat switching models like handing a task from one engineer to another.

```text
Claude
   │
   │ quota / cost / failure
   ▼
┌──────────────────────────┐
│ Handoff Compiler         │
│                          │
│ Goal                     │
│ Progress                 │
│ Decisions                │
│ Relevant code            │
│ Failed attempts          │
│ Current errors           │
│ Tests                    │
│ Git diff                 │
└────────────┬─────────────┘
             │ 2,800 tokens
             ▼
           GPT
```

The handoff could be a standardized JSON structure that **any agent/provider can understand**.

You could eventually open-source the protocol itself.

---

### 2. Context OS

Don't make chat history your memory.

Create a project knowledge graph:

```text
                 Authentication
                /      |       \
               /       |        \
          auth.ts     JWT      User
             |         |         |
          login()   decision   schema
             |                   |
          bug #38             users.sql
```

Nodes could represent:

```text
Files
Functions
Classes
APIs
Bugs
Tasks
Decisions
Commits
Requirements
Tests
Errors
Agent actions
User preferences
```

Then when someone asks:

> Why did we implement authentication this way?

the IDE can reconstruct the **reasoning history**, not merely search code.

---

### 3. Context Garbage Collector

This is one I'd experiment with heavily.

Treat tokens like RAM.

```text
Context Window: 32K

████████████████████░░░░░░░░

Hot context
auth.ts                    3.2K

Warm context
authentication decisions  1.4K

Cold context
old debugging conversation 18K
```

The system automatically:

```text
Hot → keep verbatim
Warm → compress
Cold → index
Irrelevant → remove
```

Essentially:

> **Garbage collection for LLM context.**

That's a much stronger technical problem than ordinary conversation summarization.

---

### 4. Semantic Context Diff

Before every request, calculate:

> **What does this model need to learn that it doesn't already know?**

Suppose Agent A already received:

```text
architecture
database schema
auth.ts
API structure
```

Prompt #2 shouldn't resend all of it.

Instead:

```text
CONTEXT DIFF

Since your previous execution:

auth.ts
+ refreshToken()
+ revokeToken()

database.sql
+ refresh_tokens table

Decision:
Refresh tokens expire after 30 days.
```

You start thinking of context like Git:

```text
Context V31
   ↓
Δ 1,430 tokens
   ↓
Context V32
```

This could produce serious token savings.

---

### 5. Time-Travel Agent

Normal Git answers:

> What changed?

Your system should answer:

> **Why did it change?**

Click a line:

```python
token = generate_jwt(user)
```

and see:

```text
Origin

Created:
Sept 13 · 18:42

Agent:
Claude

Prompt:
"Implement authentication"

Reason:
JWT selected because API must remain stateless.

Alternatives considered:
Sessions
OAuth-only

Modified:
3 times

Related:
Issue #41
Commit e913af
Test auth_test.py
```

That's effectively **Git blame for AI reasoning**.

---

### 6. Agent Replay

Record agent execution as reproducible events:

```text
Agent Run #381

1. Read auth.ts
2. Read schema.sql
3. Searched "login"
4. Changed auth.ts
5. npm test
6. 2 failures
7. Changed middleware.ts
8. npm test
9. 147 passed
```

Then offer:

```text
Replay
Fork
Rollback
Continue
Compare
```

This would be incredibly useful when an agent destroys something.

---

### 7. Parallel Agent Tournament

Don't always ask one model.

For difficult tasks:

```text
             Problem
                │
       ┌────────┼────────┐
       ↓        ↓        ↓
      GPT     Claude   Gemini
       │        │        │
       └────────┼────────┘
                ↓
            Evaluator
                ↓
             Tests
                ↓
          Best solution
```

But don't use another LLM alone to determine the winner.

Use objective evidence:

```text
Tests                  40%
Static analysis        15%
Security               15%
Performance            10%
Code complexity        10%
Agent review           10%
```

The IDE could literally display:

```text
                 GPT     Claude   Gemini

Tests           48/48    48/48     45/48
Latency         21ms     18ms       24ms
Warnings           1        0          3
Tokens          8.2K     11.1K       6.4K
Cost           $0.11     $0.18      $0.06

Winner                    ★
```

Now multi-model support actually has a purpose.

---

### 8. Agent Confidence + Verification Engine

Agents shouldn't simply say:

> Done.

Require evidence.

```text
Agent claims:
"Authentication bug fixed."

Verification:

✓ Compiles
✓ Unit tests
✓ Integration tests
✓ Type check
✓ Linter

⚠ No browser test
⚠ Security test not executed

Confidence: 87%
```

Even better:

```text
CLAIM                           EVIDENCE

"Bug fixed"                     auth_test passes
"No API breakage"               183 tests pass
"Input validated"               validation_test passes
"Secure against replay"         NO EVIDENCE
```

This attacks one of the biggest weaknesses of coding agents: **confidently claiming completion**.

---

### 9. Failure Memory

This is extremely valuable.

Agents repeatedly make the same mistakes.

Store failed attempts:

```text
FAILURE MEMORY

Project: AtlasQ

Attempt:
Use WebSocket connection directly from client.

Result:
Failed.

Reason:
Authentication token expires during connection.

Files affected:
stream.ts
auth.ts

Resolution:
Backend proxy + refresh mechanism.
```

Months later, another agent tries the same thing.

Your IDE interrupts:

> ⚠ This approach was attempted on June 14 and caused authentication failures.

That's real persistent engineering intelligence.

---

### 10. Architecture Guardian

Let the developer define invariants:

```text
PROJECT LAWS

01 Frontend cannot access database directly.
02 Business logic stays outside controllers.
03 No secrets in client code.
04 All API routes require validation.
05 New functionality requires tests.
06 Do not modify /legacy.
```

Every agent must obey them.

If an AI generates:

```javascript
const db = new PostgresClient(...)
```

inside React:

```text
⛔ ARCHITECTURE VIOLATION

Rule #1:
Frontend cannot access database directly.

Suggested:
Create /api/portfolio endpoint.
```

Essentially **constitutional rules for a codebase**.

---

### 11. Token ROI

Don't just display:

```text
Tokens used: 37,281
```

That's not very useful.

Display:

```text
Agent Productivity

Tokens              37.2K
Cost                 $0.42
Time                  4m12s

Useful changes
+382 lines
-114 lines
8 tests added
3 bugs fixed

Reverted AI work       31%

Cost / accepted change $0.06
```

Eventually you can calculate model performance per developer:

```text
YOUR MODEL PERFORMANCE — 30 DAYS

Claude
Acceptance      91%
Avg cost        $0.42
Success         87%

GPT
Acceptance      94%
Avg cost        $0.31
Success         92%

Gemini
Acceptance      76%
Avg cost        $0.09
Success         79%
```

Now your router learns **which model is best for this user/project**, rather than relying on global benchmarks.

---

### 12. Budget-Aware Autonomous Coding

User can say:

> Implement this issue. Maximum budget $2.

Then:

```text
Budget: $2.00

Planning           $0.04
Implementation     $0.63
Debugging          $0.38
Tests              $0.21
Review             $0.12
────────────────────────
Used               $1.38
Remaining          $0.62
```

The orchestrator dynamically chooses models based on remaining budget.

That's a much more useful primitive than token limits.

---

### 13. Context Branching

Treat AI reasoning like Git branches.

```text
                fix/payment
                    │
          ┌─────────┼─────────┐
          │         │         │
      approach-A approach-B approach-C
          │         │         │
        GPT       Claude    Gemini
```

Then:

```text
Compare approaches
```

and merge the winner.

This could become a killer feature for architectural decisions.

---

### 14. Adversarial Agent

After the Builder finishes, automatically summon a hostile reviewer.

```text
Builder Agent
     ↓
"I finished OAuth."
     ↓
Red-Team Agent
     ↓
Try to break it

• race conditions
• auth bypass
• malformed inputs
• edge cases
• dependency problems
• incorrect assumptions
     ↓
Builder fixes findings
```

Not merely code review—the second agent's objective is explicitly:

> **Prove the first agent wrong.**

For serious software this is much more useful.

---

### 15. Agent Specialization Marketplace

Instead of models:

```text
GPT
Claude
Gemini
```

users select capabilities:

```text
┌──────────────────────────┐
│ PostgreSQL Expert        │
│ React Performance Expert │
│ Security Auditor         │
│ Rust Debugger            │
│ Test Engineer            │
│ UI Designer              │
└──────────────────────────┘
```

Underneath:

```text
Agent =
Model
+ System prompt
+ Tools
+ Knowledge
+ Context strategy
+ Verification suite
```

Users could publish agent configurations.

---

## The feature I think has the most research potential

Combine **Context OS + Context Diff + Context Garbage Collector + Agent Handoff**.

You could create something like:

### Context Virtualization

Models believe they have one continuous development memory even though the underlying model may have changed 20 times.

```text
                    Developer
                        │
                        ▼
              ┌───────────────────┐
              │ Virtual Agent     │
              │ "Nova"            │
              └─────────┬─────────┘
                        │
               Context Virtualizer
                        │
       ┌────────────────┼────────────────┐
       ↓                ↓                ↓
   GPT-5.x           Claude          Gemini
    20 min            35 min          12 min
       │                │                │
       └────────────────┼────────────────┘
                        ↓
                Persistent State
```

From the user's perspective they never switched agents.

They just talk to:

> **Nova**

Behind the scenes:

```text
10:00  Claude → architecture
10:03  GPT → implementation
10:08  cheap model → tests
10:10  GPT → debugging
10:17  local model → documentation
10:20  Claude → review
```

The **model becomes an implementation detail**.

And if you want an academically interesting component, benchmark your context virtualization system against full-history prompting. Measure **task success, handoff accuracy, tokens consumed, cost, latency, forgotten constraints, repeated mistakes, and context compression ratio**. If you can show something like **60–80% lower context-token consumption with statistically comparable task success**, you're not just building an IDE feature—you potentially have a publishable context-management technique alongside the product.
