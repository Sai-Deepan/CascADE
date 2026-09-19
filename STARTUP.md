# Starting and using cascADE

cascADE opens in your browser and works with files on your computer. A local Node.js server must remain running while you use it.

## 1. Open the application

Open **PowerShell** or a PowerShell tab in **Windows Terminal**.

Run:

```powershell
Set-Location 'D:\cascADE'
npm.cmd start
```

When the terminal displays:

```text
cascADE workspace: http://127.0.0.1:4317
```

Open **http://127.0.0.1:4317** in your browser.

Keep that terminal open. If the server is already running, you can simply open the browser address.

### First-time setup

You need **Node.js 22 or newer**, including npm. Check your installation:

```powershell
node --version
npm.cmd --version
```

Install the application's dependencies once, or after dependencies change:

```powershell
Set-Location 'D:\cascADE'
npm.cmd install
npm.cmd start
```

The commands use npm.cmd to avoid PowerShell script execution-policy issues.

## 2. Try it without an API key

The **Demo · offline** provider lets you try the complete review workflow without calling an AI model.

1. Click a file in **Explorer** to open it.
2. Click **Workspace memory** at the top.
3. Enter a **Current objective**, such as “Document this project.”
4. Add a decision, such as “Keep existing public APIs unchanged,” then click **Add**.
5. Click **Save memory**.
6. Keep **Demo · offline** selected in the Model dropdown.
7. Enter “Document this project's current task and decisions” in the chat box.
8. Click **Context** to inspect what the provider will receive, then close the preview.
9. Click **Run agent**.
10. Open **Changes**, click **Review**, and inspect the before/after contents.
11. Click **Accept change** to write the proposed file, or **Reject change** to leave your files unchanged.

The demo proposes a file named **cascade-note.md**. It demonstrates context and change review; it does not generate real AI fixes.

## 3. Use your own project

By default, starting from D:\cascADE opens the cascADE repository itself.

To work on a different existing project, stop the server with **Ctrl+C**, then run:

```powershell
Set-Location 'D:\cascADE'
$env:CASCADE_WORKSPACE = 'D:\projects\my-app'
npm.cmd start
```

Replace D:\projects\my-app with your project's actual folder. Stay in the cascADE application directory when running npm.cmd start.

Reload the browser. The project name and file explorer will reflect the selected folder.

To return to the cascADE repository, stop the server and run:

```powershell
Remove-Item Env:CASCADE_WORKSPACE -ErrorAction SilentlyContinue
Set-Location 'D:\cascADE'
npm.cmd start
```

Environment variables set this way apply to the current terminal session. Set them again when using a new terminal.

## 4. Connect a real AI provider

Configure providers in the same PowerShell window where you start cascADE. Stop the server before changing configuration, then restart it and reload the browser.

### Anthropic

You need an Anthropic API key and a model ID enabled for your account.

```powershell
Set-Location 'D:\cascADE'
$env:ANTHROPIC_API_KEY = Read-Host 'Paste your Anthropic API key' -MaskInput
$env:ANTHROPIC_MODEL = 'YOUR_ENABLED_MODEL_ID'
npm.cmd start
```

Replace YOUR_ENABLED_MODEL_ID with your model's actual ID. The masked-input command requires **PowerShell 7+**; otherwise provide the environment variable through your existing credential setup.

Select **Anthropic** in the Model dropdown. API calls use your account and may incur charges.

Optional cost-meter settings are USD per **million** tokens:

```powershell
$env:ANTHROPIC_INPUT_PRICE = 'YOUR_INPUT_RATE'
$env:ANTHROPIC_OUTPUT_PRICE = 'YOUR_OUTPUT_RATE'
```

Replace both placeholders with numeric rates for your model before restarting. Without rates, the app displays **unpriced**.

### Ollama

Have Ollama running with a model already installed. Set its exact installed model name:

```powershell
Set-Location 'D:\cascADE'
$env:OLLAMA_MODEL = 'YOUR_INSTALLED_MODEL_NAME'
npm.cmd start
```

Select **Ollama · local** in the Model dropdown.

The default Ollama address is http://127.0.0.1:11434. If yours is different, set OLLAMA_URL before starting:

```powershell
$env:OLLAMA_URL = 'http://127.0.0.1:11434'
```

### Switching models

Select another configured provider in the Model dropdown before your next request. Your task, decisions, and compact progress summary remain available to the new model.

- **Manual** uses only the selected provider.
- **Automatic fallback** can try the other configured real provider after rate limits or transient connection/server failures. Configure both Anthropic and Ollama to use this.
- Fallback never silently switches to the offline demo.

Provider configuration is read at server startup. A model marked **setup required** needs its environment variables set and the server restarted.

## 5. Everyday workflow

| Area | How to use it |
| --- | --- |
| Explorer | Search for a file and click it to open. Use the refresh button after external file changes. |
| Editor | Edit the open file, then click **Save** or press **Ctrl+S**. Save before asking the agent to use your changes. |
| Workspace memory | Maintain your objective, progress, next steps, and decisions. Update the objective when starting a different task. |
| Chat | Describe the task and name relevant files. The active file is prioritized when building context. |
| Context | Preview the compact handoff, including selected files and memory, before sending it. Unsaved editor changes are not included. |
| Changes | Review each proposed file and accept or reject it. Acceptance writes directly to disk. |
| Activity | Inspect saved-file, memory, provider, and command events. |
| Context & usage | Inspect token usage, configured cost estimates, and the input context budget. |

Accepted changes still need verification. Review test output and your project's normal checks before committing.

### Run commands

The in-app **Terminal** is a command runner with three supported commands:

```text
git status
git diff
node --test
```

Type one and click **Run**.

- git status lists repository changes.
- git diff shows tracked, unstaged changes; newly created files do not appear in that diff.
- node --test runs Node's test discovery. Read the output to confirm tests were actually found and passed.

Run other project commands, such as npm test or a development server, in a separate terminal opened in your project directory. Repository tests execute on your computer; the command runner is not an isolated sandbox.

## 6. Stop, restart, and resume

To stop cascADE, switch to the terminal running the server and press **Ctrl+C**. If Windows asks to terminate the batch job, confirm with **Y**.

To resume:

```powershell
Set-Location 'D:\cascADE'
npm.cmd start
```

Set your project/provider variables first if you opened a new terminal.

Your selected project's **.cascade/state.json** stores conversation history, task memory, decisions, run history, and pending proposals. Restarting the server does not clear it. Keep **.cascade/** out of version control in each project you open.

## 7. Troubleshooting

| Problem | What to do |
| --- | --- |
| Browser says the site cannot be reached | Run npm.cmd start and keep its terminal open. Use the exact address printed there. |
| node or npm is not recognized | Install Node.js 22+ with npm, then reopen your terminal. |
| npm.ps1 is blocked | Use npm.cmd as shown in this guide. |
| npm reports no package.json | Run Set-Location 'D:\cascADE' before starting or installing. |
| Port 4317 is already in use | Open the existing instance, stop it, or choose another port using the commands below. |
| Provider says setup required | Set the required variables in the server's terminal, restart, and reload the browser. |
| Anthropic reports HTTP 401 | Check your API key and account access. |
| Ollama connection fails | Check that Ollama is running, its address is correct, and the configured model is installed. |
| Context exceeds the budget | Shorten your task/memory or raise the input budget within the provider's available context capacity. |
| File changed since proposal | Reject the stale proposal and generate a new one using the latest file contents. |
| File changed on disk while saving | Copy your unsaved edits somewhere safe, reopen the file, and reconcile the changes before saving again. |
| Invalid session token | Reload the page after restarting the server. |
| Monaco is unavailable | Run npm.cmd install from D:\cascADE, then reload. The plain text fallback still supports editing. |

To use a different port:

```powershell
Set-Location 'D:\cascADE'
$env:PORT = '4319'
npm.cmd start
```

Then open **http://127.0.0.1:4319**.

For architecture, configuration limits, and the remaining roadmap, see [Implementation details](docs/IMPLEMENTATION.md).

