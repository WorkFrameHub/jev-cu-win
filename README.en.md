# jev-cu-win

English | [日本語](README.md)

A **Windows port** of [Jev-cu](https://github.com/Sac-Y/Jev-cu).

It lets **Jev** (TypeSafe's System One model) decide "what to click next" in a Windows app, and performs the action through Windows **UI Automation**.

- Only **text** from the screen is sent to Jev (no screenshots)
- **Dry-run by default**: it shows Jev's decision and clicks nothing
- Delete, send, pay, sign-in, install and similar actions ask for **y/N confirmation** before they run

## How it works

```
 ┌─────────────┐  screen text  ┌──────────────┐  what to click? ┌────────────┐
 │ Windows app │ ────────────▶ │  jev-cu-win  │ ──────────────▶ │  Jev API   │
 │ (Calculator)│ ◀──────────── │ + safety gate│ ◀────────────── │ (TypeSafe) │
 └─────────────┘  click / type └──────────────┘ element + conf. └────────────┘
```

1. **Observe**: a PowerShell host (`scripts/uia-host.ps1`) lists the window's buttons, fields and text through UI Automation
2. **Decide**: candidates are picked from that list, and Jev is asked for the next element, the action type, whether the goal is done, and whether the action is risky
3. **Gate**: `scripts/policy.mjs` stops apps outside the allowlist and risky actions
4. **Act**: if the gate passes, it clicks or types, then goes back to step 1

## Requirements

- Windows 10 / 11
- [Node.js](https://nodejs.org/) 20 or later (the LTS build)
- A TypeSafe API key (https://console.typesafe.ai/settings/keys)

It uses the PowerShell that ships with Windows. Nothing else to install.

## Setup

In PowerShell or Command Prompt:

```powershell
git clone https://github.com/WorkFrameHub/jev-cu-win.git
cd jev-cu-win
copy .env.example .env.local
notepad .env.local
```

When Notepad opens, paste your API key after `TYPESAFE_API_KEY=` and save.

There are no dependencies (`npm install` is not needed).

## Use as a Codex skill (optional)

The CLI remains available as before. `skill/jev-cu-win/SKILL.md` is a thin instruction layer for Codex to call it. Inspired by the original [Jev-cu skill + scripts structure](https://github.com/Sac-Y/Jev-cu), it uses this Windows PowerShell UI Automation backend, with no macOS AX or `cua_repl` dependency. **Installing SKILL.md does not install/configure Node.js, PowerShell or an API key.** The user prepares those separately using Setup above; the skill installer never handles credentials.

### Check prerequisites

From the checkout root, these checks use neither the API nor the GUI:

```powershell
node --version                         # 20+
Get-Command powershell.exe             # default PowerShell
# If JEV_CU_POWERSHELL is set, also check that selected executable
node scripts/cli.mjs --help
node scripts/install-skill.mjs --help
```

No npm dependencies are required. For `run`, the user must already have prepared `TYPESAFE_API_KEY` in the process environment or the checkout's `.env.local`. Do not ask an agent to retrieve or display its value. `windows` and `observe` need no API key.

Skill discovery does not grant access to the intended Windows desktop. The [official Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox) describes configurations using a private desktop. GUI access across WSL, cloud or sandbox boundaries to the normal host desktop is not verified support. At runtime, check the intended target with `windows` / `observe`; if unavailable, stop and hand off to the user's Windows terminal. Disabling the sandbox is not the standard setup procedure.

### Install

The default is `$HOME/.agents/skills/jev-cu-win`, following the [current official discovery locations](https://learn.chatgpt.com/docs/build-skills) (checked 2026-10-17), rather than copying the original installer's `~/.codex/skills` destination. Check the documentation for the Codex host you will actually use.

The following command **writes skill files**. Run it only when you want to install on that Windows host:

```powershell
node scripts/install-skill.mjs
```

It replaces `{{REPO_DIR}}` with this checkout's absolute path and copies the instructions, MIT `LICENSE` and an ownership manifest. It does not copy the CLI, so retain the checkout. An existing destination is refused rather than overwritten.

For a project-scoped installation, explicitly select that project's `.agents/skills`:

```powershell
node scripts/install-skill.mjs --skills-dir "C:/path/to/project/.agents/skills"
```

`--skills-dir` is the **parent** of the `jev-cu-win` folder. Codex also scans `.agents/skills` from its working directory up to the repository root. Avoid duplicate user/project installations. Invoke `$jev-cu-win` in Codex; changes are detected automatically. Restart Codex if they do not appear.

### Update or remove

In the same checkout, obtain and review desired changes using your normal Git workflow, then refresh the installed copy:

```powershell
node scripts/install-skill.mjs --update
node scripts/install-skill.mjs --uninstall
```

If you selected `--skills-dir`, pass the same value for updates/removal. Management requires the same owning checkout and unchanged installed files. Another checkout, links, extra files or local edits cause a refusal; back up/reconcile those manually first. The installer never unconditionally removes a destination recursively. Uninstall before moving the checkout, then reinstall at the new location. Removal affects the skill only, leaving the CLI, logs and API key in place.

### Agent execution and confirmation

- `windows` / `observe` do not call TypeSafe. **Every `run`, including dry-run, can send screen text, goals and other context to the metered TypeSafe API.** Understand and authorize that data transfer/cost before the first API-backed run. Dry-run prevents GUI actions; it is not an offline test.
- Preview one decision for a new workflow, then add `--execute` only within the authorized scope. Use `--done-when` and a subsequent `observe` to verify success. Supply user-approved input through `--text`; selecting a text field may click and type it in one step.
- **In a non-TTY agent shell, y/N cannot be answered: confirmation returns false and stops with `confirm` (exit code 2).** Chat approval does not feed the CLI prompt. The agent explains the specific target, action and gate reasons, obtains any missing authorization, and hands the command **without `--yes`** to the user's interactive Windows terminal. The user reviews the fresh decision and y/N prompt. Rerunning makes a new API decision and can choose a different action; it does not resume an approved stored plan.
- Do not routinely add `--yes`, pipe `y`, widen the allowlist or lower thresholds to bypass a gate. Stay stopped if handoff is unavailable. Stop for `ask_user`, `stop`, `escalate`, errors or uncertain outcomes too; inspect the current state before retrying. Earlier steps may already have run, so never blindly replay typing or whole tasks.
- JSONL under `runs/` and console output can include goals, plans, screen labels and decisions. Keep secrets out of screens and arguments; never paste keys, `.env.local`, raw logs or screenshots into PRs/chat. Password filtering and truncation are not complete redaction.

## Usage

### 1. List open windows

```powershell
node scripts/cli.mjs windows
```

### 2. Look at an app's UI (does not call Jev, free)

Open Calculator, then:

```powershell
node scripts/cli.mjs observe --app Calculator
```

You should see numbered elements such as `32 button Seven, ID: num7Button`.

### 3. Dry run (clicks nothing)

```powershell
node scripts/cli.mjs run --app Calculator --goal "enter the digit 7"
```

It prints which element Jev chose. **Write the goal (`--goal`) in English for the best accuracy.**

### 4. Actually operate the app

```powershell
node scripts/cli.mjs run --app Calculator --goal "calculate 12 times 3" --execute --max-steps 8
```

### Tell it when the task is done

Jev sometimes cannot tell that the goal is already reached and stops. With `--done-when`, the run finishes as soon as that text appears on screen (copy the text exactly as `observe` prints it):

```powershell
node scripts/cli.mjs run --app Calculator --goal "calculate 12 times 3" --execute --max-steps 8 --done-when "Display is 36"
```

### Typing text (Notepad)

Jev does not write text. Pass the text to type with `--text`:

```powershell
node scripts/cli.mjs run --app Notepad --goal "type the text into the editor" --text "Hello" --execute --done-when "Hello"
```

### Options

| Option | Meaning |
| --- | --- |
| `--execute` | Actually operate the app (otherwise dry run) |
| `--max-steps <n>` | Maximum number of steps (default 10) |
| `--text <text>` | Text to type (for type_text / set_value) |
| `--key <key>` | Key to press, e.g. `Enter`, `ctrl+s`, `alt+F4` |
| `--direction <dir>` | Scroll direction: `up` / `down` / `left` / `right` |
| `--at <x,y>` | Click position, relative to the window's top-left corner |
| `--from <x,y>` `--to <x,y>` | Drag start and end (same coordinates) |
| `--allow-app <name>` | Add an app to the allowlist (repeatable) |
| `--plan <text>` | Step-by-step hint passed to Jev (English recommended) |
| `--done-when <text>` | Finish when this text appears on screen (repeatable) |
| `--yes` | Approve actions that need confirmation automatically (**not recommended**) |

`--app` takes a window title (`Calculator`, `Notepad`, ...; partial match works) or a process name (`notepad`, `CalculatorApp`, ...).

## Safety

- **Dry run by default**. It only acts when you pass `--execute`
- **Allowlist** (`DEFAULT_ALLOWED_APPS` in `scripts/policy.mjs`): Calculator, Notepad, Paint, Edge, Chrome (English and Japanese names). Any other app asks for confirmation every time
- Elements containing **sensitive words** (delete, send, buy, password, install, share, ... in English, Japanese and Chinese), and actions Jev rates as risky, ask for confirmation before they run. Invisible characters such as zero-width spaces are stripped before this check
- It stops when its confidence is low
- It never reads the contents of password fields
- It refuses to type the same text twice in one run
- Every run is logged as JSONL in the `runs/` folder

## For developers

```powershell
npm test     # unit tests (no API calls, also run outside Windows)
npm run p0   # saved UI-tree eval (metered TypeSafe API calls; needs an API key)
```

| File | Role |
| --- | --- |
| `scripts/cli.mjs` | Command-line entry point |
| `skill/jev-cu-win/SKILL.md` | Source instructions for Codex to use the CLI |
| `scripts/install-skill.mjs` | Copy/install, update and remove the skill (no API / GUI) |
| `scripts/loop.mjs` | Observe → decide → gate → act loop |
| `scripts/jev-decide.mjs` | Jev API calls |
| `scripts/policy.mjs` | Safety gate (allowlist, sensitive words, thresholds) |
| `scripts/uia-driver.mjs` | Node.js ⇔ PowerShell transport |
| `scripts/uia-host.ps1` | Reads and operates the screen through UI Automation (PowerShell 5.1 / 7) |
| `fixtures/uia/` | Test UI trees (modeled on Windows 11 Japanese Calculator and Notepad) |
| `TESTING.md` | Manual test plan for a real Windows machine (Japanese) |

To use a different PowerShell (e.g. PowerShell 7), set the environment variable `JEV_CU_POWERSHELL=pwsh.exe`.

## Differences from the original Jev-cu

| | Jev-cu (original) | jev-cu-win |
| --- | --- | --- |
| OS | macOS | Windows |
| Reading and operating the screen | Codex desktop app Computer Use | Windows UI Automation (PowerShell) |
| How to run | Inside Codex's `cua_repl` | Plain command line |
| Risky actions | Stops and exits | Asks y/N on the spot |

## Limitations

- An app running as administrator cannot be operated from a non-administrator terminal
- Games and some custom-drawn apps do not expose elements to UI Automation and cannot be operated
- Browser pages have many elements and may be truncated at the limit (1500 elements)

## License

[MIT](LICENSE). Based on the original Jev-cu © 2026 Sac-Y.
