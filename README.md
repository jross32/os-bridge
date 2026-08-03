# Reflex

**Reflex is a Windows-only MCP server that lets an AI client inspect and operate a local Windows machine.** It combines system and process inspection, file and clipboard work, window management, screenshots, visible mouse/keyboard input, and persistent PowerShell or Command Prompt sessions in one stdio MCP server.

Reflex is for jobs that cannot be completed through repository files or browser automation alone: inspecting a native desktop application, checking the process behind a port, operating an installed Windows application, or completing a supervised visible workflow.

> [!WARNING]
> Reflex runs with the permissions of the Windows account that starts it. It is not a sandbox, and a control lease only gates visible mouse, keyboard, and window-input tools. Shell, file, clipboard, and process tools remain powerful capabilities. Connect it only to AI clients you trust, use the narrowest task possible, and keep a person in the loop for consequential work.

## What Reflex provides

| Area | Examples |
| --- | --- |
| System and network inspection | System health, disk use, services, processes, ports, adapters, DNS, firewall rules, scheduled tasks |
| Files and text | Read/write files, line ranges, search, hashes, diffs, directory size, copy/move/delete, ZIP extraction |
| Windows and display | Window discovery, focus, position/size, minimize/maximize, screenshots, display information |
| Desktop input | Mouse movement/click/drag/scroll, text entry, key presses, clipboard access |
| Command execution | One-shot commands plus open/send/read/close persistent PowerShell or `cmd.exe` sessions |
| Agent workflow support | Structured MCP errors, tool discovery, prompts, runbooks with risk-aware approval pauses |

The live server is the source of truth: call MCP `tools/list` and `prompts/list` to discover the installed version’s exact surface and schemas.

## Requirements

- Windows 10 or Windows 11
- A supported Node.js runtime (the repository is tested with current Node releases)
- An MCP-capable AI client that can launch a stdio command
- PowerShell, which is used for Windows inspection and desktop integration

Reflex has no npm runtime dependencies. `npm install` is still a useful setup step because it records the local package state and supports familiar npm commands.

## Install and run

```powershell
git clone https://github.com/jross32/os-bridge.git reflex
Set-Location reflex
npm install
npm start
```

`npm start` speaks MCP JSON-RPC on standard input/output. Do not type normal terminal commands into that process; configure an MCP client to launch it.

### Generic stdio MCP configuration

Most MCP clients accept a configuration shaped like this. Replace the path with the absolute location of your checkout.

```json
{
  "mcpServers": {
    "reflex": {
      "command": "node",
      "args": ["C:\\path\\to\\reflex\\mcp-server.js"],
      "env": {
        "REFLEX_AGENT_NAME": "My AI client"
      }
    }
  }
}
```

The optional `REFLEX_AGENT_NAME` is shown to the person at the computer when a visible-control lease starts. When it is omitted, Reflex tries the MCP client identity and common Synapse environment variables first.

### Optional HTTP discovery helper

```powershell
npm run http
```

This starts an unauthenticated helper on port `11300` by default. It offers:

- `/health` — version, tool count, prompt count, and transport metadata
- `/tools` — current tool names and descriptions as JSON
- `/docs` — a browser-readable live catalog

Set `REFLEX_HEALTH_PORT` to choose another port; `OS_BRIDGE_HEALTH_PORT` remains a compatibility fallback. The helper is for discovery only: tool execution still happens through stdio MCP. Because the current helper has no authentication, do not expose its port through a firewall rule, tunnel, or public network.

## Safety and visible control

Before an AI can use mouse, keyboard, scrolling, drag, or window-input actions, it must call `request_control`. Reflex then starts a topmost control strip that identifies the AI and gives the person at the machine direct control:

- **Pause / Resume:** pauses AI input so the person can work, then returns the same lease.
- **Release:** ends the lease and removes the control strip.
- **Emergency stop:** immediately blocks input and remains sticky until explicitly reset.
- **Exit Reflex:** shuts down the MCP server.
- **Physical Esc:** triggers the sticky emergency stop. Esc injected by an AI is ignored.

While active, Reflex can replace the standard cursor with a blue highlighted pointer. If the control strip cannot start or exits unexpectedly, Reflex fails closed by revoking input control. Cursor state is restored on pause, release, emergency stop, normal shutdown, and parent-process exit.

`REFLEX_DISABLE_OVERLAY=1` is intended only for non-interactive automated tests. It preserves server-side lease enforcement but removes the human-visible strip, so it must not be used for ordinary supervised operation.

### Launch-time security policy

Reflex now starts in **guarded** mode by default. Guarded mode permits low-risk inspection only and blocks commands, persistent shells, mutations, process/service control, clipboard/environment reads, screenshots, and URL launching. This is deliberate: an MCP client cannot relax its own policy.

For a supervised development session, the Windows owner—not the AI—may explicitly restart Reflex with `REFLEX_SECURITY_MODE=developer`. Narrow the session further with semicolon-separated `REFLEX_ALLOWED_PATHS` and `REFLEX_ALLOWED_APPS` values, and use `REFLEX_AUDIT_DIR` to choose where durable redacted action receipts are stored. Call `get_security_policy` before work and `get_action_receipts` afterward.

### Practical safety rules

1. Prefer a direct application API or structured browser automation before using screen coordinates.
2. Inspect first; use the smallest necessary action second; verify the resulting state third.
3. Treat `run_command`, persistent shell sessions, file writes/deletes, clipboard reads, process kills, service management, and external navigation as potentially consequential even though they do not need a visible-input lease.
4. Ask for confirmation before sending data, changing accounts/settings, installing software, deleting files, stopping processes, or accepting terms.
5. Do not give Reflex to an untrusted remote MCP client. Screenshots, clipboard contents, file paths, environment values, and shell output can contain sensitive information.

## Recommended operating pattern

For reliable desktop work, use a deliberate observe → act → verify loop:

1. Call `get_focused_app_state`, `list_windows_detailed`, or `screenshot_window` to establish the target.
2. Prefer a PID or window handle over a loose title match when targeting a window.
3. Request visible control immediately before input is needed.
4. Focus the intended window, perform one small action, and capture/inspect the result.
5. Release control when the visible task is complete.

For websites, use browser-native automation such as Playwright when a DOM/accessibility tree is available. Reflex is the fallback for native applications and visual workflows that browser automation cannot reach.

## Testing and verification

```powershell
npm run check              # Node syntax check
npm test                   # safe regression suite
npm run test:dangerous     # includes actions that can affect the live machine
npm run ux:smoke           # controlled UX scenario
npm run ux:visible         # visible desktop demonstration
npm run ux:agent-mode      # visible agent-mode parity scenario
```

See [tests/README.md](tests/README.md) for result artifacts, safety expectations, and how to interpret failures. Visible tests may move the pointer, create/focus windows, or affect the clipboard; close unrelated work before running them.

## Documentation map

- [Operator guide](DOCS.md) — concepts, workflows, risk boundaries, and troubleshooting
- [MCP tool standards](MCP_TOOL_STANDARDS.md) — contribution contract for tools and prompts
- [Release checklist](RELEASE_CHECKLIST.md) — documentation, tests, and release hygiene
- [Test guide](tests/README.md) — suite structure and generated evidence
- [Security policy](SECURITY.md) — threat model, deployment guidance, and vulnerability reporting

## License

MIT (declared in `package.json`).
