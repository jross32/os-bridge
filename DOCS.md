# reflex Operator Guide

Use this server when an AI client needs real Windows OS access rather than repository-only analysis.

## Best-Fit Jobs

- Read and write files
- Run shell commands or keep persistent shell sessions
- Inspect processes, ports, system state, and windows
- Read and write clipboard data
- Capture screenshots or automate visible UI actions

## Important Constraints

- Windows-only
- Visible automation can move the mouse, focus windows, and type into apps
- Some tests intentionally require opt-in because they can affect the live desktop

## Visible Control Lease

Before using a mouse, keyboard, or window-input tool, call `request_control`.
Reflex opens a topmost strip that names the connected AI and replaces the real
Windows pointer with a blue highlighted cursor for the duration of the lease.

The user always has these controls:

- **Pause / Resume** — temporarily blocks AI input and restores the normal cursor so the user can work, then hands the same lease back to the AI.
- **Release** — ends the lease cleanly. A new `request_control` call is required before more input.
- **Emergency stop** — ends the lease and keeps all input blocked until `reset_emergency_stop` is deliberately called.
- **Exit Reflex** — ends the Reflex MCP process itself.
- **Physical Esc** — last-resort emergency stop. Windows-injected Esc events from an AI are ignored.

Reflex fails closed: if the safety strip cannot start or exits unexpectedly,
the AI does not retain input access. The normal system cursors are restored on
Pause, Release, Emergency stop, Exit Reflex, parent-process exit, and normal
overlay shutdown.

For automated non-interactive tests only, `REFLEX_DISABLE_OVERLAY=1` suppresses
the strip while keeping lease state enforcement active.

## Common Commands

```powershell
npm start
npm run http
npm test
npm run test:dangerous
npm run ux:smoke
npm run ux:visible
npm run ux:agent-mode
```

## HTTP Helper Server

When launched with `npm run http`, the helper server exposes:

- `/health`
- `/docs`
- `/tools`

Prompt discovery should still use MCP `prompts/list` over stdio.

## Tool Families

- System info and diagnostics
- Process and port inspection
- File and directory operations
- Clipboard and screenshot helpers
- Window management and visible desktop automation
- Named control leases and human takeover controls
- Shell session lifecycle tools

Use `tools/list` for the current live surface instead of relying on hardcoded counts in docs.
