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
npm run p0   # offline eval: Jev's accuracy on saved UI trees (needs an API key)
```

| File | Role |
| --- | --- |
| `scripts/cli.mjs` | Command-line entry point |
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
