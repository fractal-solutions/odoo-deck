# odoo-deck

A keyboard-first terminal command center for **local Odoo development on Windows**.

odoo-deck puts the Odoo operations you normally type by hand — streaming logs, copying module
sources into the addons path, installing/upgrading modules, resetting a stuck database, and
restarting the Windows service — into one clean, full-screen TUI that works for **any Odoo
codebase**, not just one specific set of modules.

Built with [Bun](https://bun.com) + [Ink](https://github.com/vadimdemedes/ink) in plain
JavaScript (no TypeScript). No framework lock-in: it just shells out to the same binaries you
would use yourself (`odoo-bin`, `robocopy`, `psql`, `Get-Service`) and shows you everything it runs.

---

## Table of contents

- [Why odoo-deck](#why-odoo-deck)
- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Screens & keys](#screens--keys)
  - [1 · Home / Actions](#1--home--actions)
  - [2 · Logs](#2--logs)
  - [3 · Settings](#3--settings)
  - [e · Error view](#e--error-view)
  - [Module picker](#module-picker)
- [Configuration](#configuration)
- [How the actions actually work](#how-the-actions-actually-work)
- [Administrator rights & auto-elevation](#administrator-rights--auto-elevation)
- [Project layout](#project-layout)
- [Scripts](#scripts)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [Limitations](#limitations)

---

## Why odoo-deck

A typical local-Odoo workflow on Windows involves:

```powershell
# stop the service, or the CLI can't bind the port / two servers fight over the DB
Stop-Service odoo-server-19.0

# copy your modules into the addons path
robocopy C:\dev\myrepo\custom C:\Program Files\Odoo ...\server\odoo\addons /E /NFL /NDL

# upgrade or install
& "C:\Program Files\Odoo ...\python\python.exe" odoo-bin -c odoo.conf -d mydb -u my_module --stop-after-init

Start-Service odoo-server-19.0
Get-Content ...\odoo.log -Tail 50 -Wait   # and a second window for logs
```

odoo-deck packages all of that into one window, shows you **exactly what command it runs** and
**why something failed** (full Python traceback, copyable to your clipboard in one keystroke), and
stops you from foot-gunning yourself:

- module installs default to **nothing selected** (no accidental mass install),
- dependency modules are copied **automatically** by reading each `__manifest__.py`,
- stuck `to install / to upgrade / to remove` DB states can be reset with one action.

It is **generic**: there is nothing hard-coded about a particular vendor's modules. The module
sources, database, service name, and paths are all in an editable `config.json`.

---

## Features

- Full-screen TUI with three tabs plus an error screen.
- **Home** actions for the daily workflow.
- **Live log tail** of the running Odoo log file (streams into the console).
- **Health panel**: service state, DB reachability, admin rights, module source checks,
  and every path it cares about (green `ok` / red `MISSING`).
- Multi-select **module picker** filtered by install state (installed vs installable).
- **Automatic dependency expansion**: before installing, odoo-deck parses `depends` from each
  module's manifest and copies the transitive dependencies found in your sources, so Odoo can
  resolve them (no more `module X depends on Y ... not available in your system`).
- **Reset stuck module states** — clears the transient `to install / to upgrade / to remove`
  leftovers that make Odoo re-process stale batches on every boot.
- **Elaborate error reporting**: when an Odoo install/upgrade fails, odoo-deck captures the whole
  block of log lines from the start of that run (including the Python traceback) and opens an
  error screen. Press `c` to copy the full report to the Windows clipboard.
- **Auto-elevation**: launching from a normal terminal triggers a UAC prompt and restarts itself
  as Administrator in a black, 160x50 console.
- Config edits validated (numeric fields refuse junk), secrets masked.

---

## Requirements

- **Windows** (the tool uses `robocopy`, `clip.exe`, Windows services, and PowerShell/cmd).
- **Bun** `>= 1.4` (install from https://bun.sh).
- A locally installed **Odoo** (tested against Odoo 19 Enterprise on Windows) reachable as a
  Windows service, with its bundled Python and PostgreSQL tools.
- **Administrator** rights for write actions (copying into `C:\Program Files\...` and
  start/stopping the service). odoo-deck auto-elevates, but you can also just run it in an
  elevated terminal.

---

## Quick start

```powershell
cd C:\dev\odoo-deck
bun install
bun start        # opens the TUI (accept the UAC prompt if asked)
bun status       # non-interactive health report, no UI
bun test/smoke.jsx   # headless UI smoke test
```

On first run odoo-deck creates `config.json` in the project root with sensible defaults and
probes your setup. Open **Settings (3)** to point it at *your* Odoo install, database, and module
source directories.

> **Tip:** make sure the values under **Settings** match your machine before running any
> install/upgrade. The **Health** panel turns red (`[!!]` / `MISSING`) for anything it cannot
> find.

---

## Screens & keys

Tabs are switched with the digit keys **from any screen**, so `3` always opens Settings whether
you're on Home, Logs, or the Error view.

| Key        | Where | Action                                   |
| ---------- | ----- | ---------------------------------------- |
| `1`        | all   | Go to **Home** tab                       |
| `2`        | all   | Go to **Logs** tab                       |
| `3`        | all   | Go to **Settings** tab                   |
| `e`        | all   | Open **Error** view (when an error exists) |
| `↑`/`↓`    | lists | Move selection                           |
| `Enter`    | lists | Run selected action / confirm            |
| `q`        | Home  | Quit                                     |
| `c`        | Error | Copy the full error report to clipboard  |
| `h` / `1`  | Error | Back to Home                             |
| `Esc`      | picker / edit | Cancel selection / editing       |

The active tab is shown as a highlighted `[ label ]` pill. The selected menu/picker row is
prefixed with `>` and colored.

### 1 · Home (Actions)

| Action                          | What it does                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Sync module sources → Odoo addons | Copies every module found in your configured source dirs into the addons path (`robocopy /E`, never deletes). |
| Install modules                 | Multi-select installable modules; auto-copies dependencies, stops the service, runs `odoo-bin -i`, restarts it. |
| Upgrade modules                 | Multi-select modules already installed; runs `odoo-bin -u`.                                      |
| Copy + upgrade modules          | Copy the chosen modules first, then upgrade them.                                                |
| Reset stuck module states       | Clears `to install / to upgrade / to remove` states in the DB (same SQL Odoo itself uses after a failed run). |
| Restart Odoo service            | Stops and starts the configured Windows service.                                                 |
| Open live log tail              | Switches to the Logs tab.                                                                        |
| View last error                 | Opens the error screen (shown only when an error was captured).                                  |

Actions that need Administrator or a reachable DB are disabled and tagged `(admin needed)` /
`(db down)` when the requirement isn't met — the Health panel explains why.

### 2 · Logs

Streams new lines appended to your Odoo log file (it starts at the current end of file, so it does
not re-read a huge history). The left pane shows the file and a `STREAMING` / `PAUSED` state.

| Key    | Action                          |
| ------ | ------------------------------- |
| `Space`| Pause / resume the live tail    |
| `c`    | Clear the console pane          |
| `1/2/3`| Switch tabs                     |

### 3 · Settings

Every config value is a full-width row: label on the left, value on the right (long paths are
readable because the value column spans the terminal). Passwords are masked.

- `↑`/`↓` move between fields, `Enter` starts editing.
- While editing a green `EDIT …` bar at the bottom shows your current input; `Enter` commits,
  `Esc` cancels, `Backspace`/`Delete` erase.
- The last row, **Save settings**, writes `config.json` and re-probes the health panel (`s` also
  saves).

### e · Error view

When an action fails you are taken straight here. The screen shows the command, the exit status,
and the captured output/traceback (scroll with `↑`/`↓` / `PageUp` / `PageDown`).

Press `c` to copy the **entire report** to the Windows clipboard (`clip.exe`) — a confirmation
with the character count is printed to the console.

### Module picker

| Key    | Action                 |
| ------ | ---------------------- |
| `↑`/`↓`| Move cursor            |
| `Space`| Toggle current module  |
| `a`    | Select all             |
| `n`    | Select none            |
| `Enter`| Run                    |
| `Esc`  | Cancel                 |

Selection starts **empty on purpose** — install exactly what you intend.

---

## Configuration

`config.json` (project root, created on first run) holds everything. All fields are editable in
the Settings UI or directly in the file.

| Field            | Meaning                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `installDir`     | Root of the Odoo install (e.g. `C:\Program Files\Odoo 19.0e...`).  |
| `python`         | Full path to the Odoo Python executable.                           |
| `odooBin`        | Full path to `odoo-bin`.                                           |
| `odooConf`       | Full path to the `odoo.conf` used by the service/CLI.              |
| `logFile`        | Odoo log file to tail and to read tracebacks from.                 |
| `psql`           | Full path to `psql.exe` (used to read module states and reset them). |
| `srcDirs`        | **Comma-separated** module source directories. Modules are discovered here; each one is copied into `destAddons`. Example: `C:\dev\repo\custom,C:\dev\repo\third_party\oca,C:\dev\repo\third_party\unicoding`. |
| `destAddons`     | The addons path your Odoo instance actually loads modules from (the copy target). |
| `service`        | Windows service name (e.g. `odoo-server-19.0`).                    |
| `db.host/port/user/password/name` | PostgreSQL connection used for read-only queries and the reset action. |

Copying is **merge-only**: files are copied from the sources into `destAddons` with
`robocopy /E` and nothing is ever deleted there, so the bundled community/enterprise modules in a
shared addons folder are never touched.

---

## How the actions actually work

Behind the scenes each action runs the same commands you'd run by hand, and every command line is
printed to the console pane:

1. **Copy** — `robocopy <src module dir> <destAddons> /E /R:1 /W:1 /NJH /NFL /NDL /NP`
   (robocopy exit codes `0..7` are treated as success; `8+` is an error).
2. **Install/upgrade** — stop service if running → run
   `python odoo-bin -c <odooConf> -d <db> -i|-u <modules> --stop-after-init` while streaming the
   Odoo log → restart the service if it was running.
3. **Dependency closure** — each module's `__manifest__.py` is scanned for `depends`, expanded
   transitively across the configured sources, and those modules are copied too so that
   `odoo-bin -i` can resolve them.
4. **States & health** — module install states come from `ir_module_module` via `psql`.
   *Reset stuck module states* runs the exact SQL Odoo ships for cleaning up after a failed run:
   `to remove`/`to upgrade` → `installed`, `to install` → `uninstalled`.
5. **Error capture** — on a failed Odoo run, everything written to the log from the moment the CLI
   started (up to the last 500 lines) is stored, including the Python traceback.

---

## Administrator rights & auto-elevation

Copying into `C:\Program Files\...` and controlling a Windows service require elevation, so by
default odoo-deck:

1. Detects whether it is running elevated.
2. If not, writes a tiny `.odoo-deck-elevate.cmd` wrapper and relaunches itself with
   `Start-Process cmd.exe -Verb RunAs` — a **UAC prompt** appears and odoo-deck opens in a new,
   black **160×50** console (cmd's `color 07`, not the blue PowerShell console).
3. The original process exits; close that window.

- Skip the auto-prompt and stay limited: `bun start --no-elevate`.
- The elevated instance is marked with the internal `--elevated` flag so it never re-prompts.
- `bun status` is read-only and never triggers elevation.

---

## Project layout

```
odoo-deck/
├─ package.json          # bun scripts + deps (ink, react)
├─ config.json           # your local config (created on first run)
├─ README.md
├─ docs/
│  ├─ odoo19-commands.md|.txt   # earlier hand-command reference
│  └─ bun.*.md                  # Bun API docs kept as reference
├─ src/
│  ├─ index.jsx          # entry point: status mode, TTY guard, auto-elevation
│  ├─ App.jsx            # the Ink TUI (tabs, menu, picker, health, error view)
│  ├─ config.js          # config schema, defaults, load/save
│  ├─ console.js         # console line bus (color/kind mapping)
│  ├─ errors.js          # last-error store (for the error view / clipboard)
│  └─ odoo.js            # all Odoo operations (probe, copy, install, tail, etc.)
└─ test/
   └─ smoke.jsx          # headless render + key-navigation smoke test
```

---

## Scripts

```powershell
bun start                 # open the TUI
bun status                # print a health report and exit (never elevates)
bun test/smoke.jsx        # headless UI smoke test
bun run build             # compile a standalone odoo-deck.exe
```

`package.json` also exposes the binary name `odoo-deck`, so `bunx odoo-deck` works when linked.

## Building a standalone executable

odoo-deck can be compiled into a single Windows `.exe` with Bun's bundler + compiler, so it runs
without Node/Bun installed and without the source tree:

```powershell
bun run build
```

or directly:

```powershell
bun build src/index.jsx --compile --outfile dist/odoo-deck.exe
```

What you get:

- `dist/odoo-deck.exe` — a self-contained executable (~86 MB) bundling the Bun runtime, Ink, and
  the app. Optional smaller size: add `--minify` to the build command.
- On first run the exe creates its own `config.json` **next to itself** (in `dist/`) and probes
  your setup. Open Settings (3) there to point it at the right Odoo install / database / module
  sources.
- Auto-elevation is compiled-aware: it relaunches the `.exe` itself (not `bun`), writing its
  `.odoo-deck-elevate.cmd` helper next to the executable.

Distribution tips:

- Ship the exe wherever you like; the config follows the exe, so keep a copy per machine.
- If you want a shared config, copy the existing `config.json` from the repo next to the exe and
  edit it there.
- The exe expects an interactive console for the TUI; `odoo-deck.exe --status` prints a plain
  health report (handy to verify a fresh copy before launching the UI).
- Rebuild with `bun run build` after any change in `src/`.

> Compiled exes are unsigned — Windows SmartScreen / Application Control may warn the first time
> you run a freshly built binary. That is expected for locally-built executables.

---

## Troubleshooting

**I keep seeing `odoo install exited with code 255` and modules I never asked for.**

This is not (usually) odoo-deck. A previous failed run leaves a batch of modules in `to install`;
Odoo then re-processes the whole stale batch on every startup, and one of them fails (for example
because a dependency module isn't in the addons path). Fix:

1. In Home, run **Reset stuck module states**.
2. Open **Settings** and make sure `srcDirs` includes all directories that hold the modules **and
   their dependencies** (custom plus the third-party folders).
3. In **Install modules**, pick only the module you actually want — odoo-deck will copy its
   dependency closure automatically.

**It says `You try to install module "X" that depends on module "Y". But the latter module is not
available in your system`.**

`Y` lives in a source dir that isn't copied into your addons path. Add that dir to `srcDirs`,
or choose **Sync module sources → Odoo addons** first, then retry.

**`(admin needed)` everywhere.**

Launch from an elevated terminal, or let odoo-deck auto-elevate (accept the UAC prompt). See
[Administrator rights](#administrator-rights--auto-elevation).

**Question marks / weird glyphs.**

odoo-deck deliberately uses only glyphs that render on legacy Windows consoles (single-line boxes,
ASCII). If you still see odd characters, your console font lacks them — switch the console font to
a TrueType one (e.g. *Consolas*) or use Windows Terminal.

**Nothing appears in the log tab.**

The log tail starts at the end of the file. Trigger some activity (or run an install) and new lines
will stream in. If the `logFile` path in Settings doesn't exist, the Health panel shows it as
`MISSING`.

**The elevated window won't open.**

If `Start-Process -Verb RunAs` is blocked in your context, just open a PowerShell **as
Administrator** once and run `bun start` there — odoo-deck detects it is already elevated and
skips the prompt.

---

## Security notes

- The PostgreSQL password in `config.json` is stored **in plain text** for local development.
  Keep the file out of version control (it is already git-ignored) and off shared machines.
- Module manifests and source directories are treated as trusted local code — odoo-deck copies
  and runs whatever those modules contain.
- `--no-elevate` runs with reduced rights if you prefer to avoid UAC prompts.

---

## Limitations

- **Windows only**: relies on `robocopy`, `clip.exe`, Windows services, and the local Odoo Windows
  layout.
- Odoo operations run against a single configured database per session; change it in Settings.
- The install/upgrade cycle stops and restarts the service, so plan around other users of that
  instance.
- Copying is one-way (repo → addons path). It never pulls changes back from the installed copy.

---

## Reference docs

The `docs/` folder keeps the original hand-command cheat sheet (`odoo19-commands.md` / `.txt`) and
the Bun API reference pages (`bun.shell.md`, `bun.spawn.md`, etc.) that were used while building
this tool.
