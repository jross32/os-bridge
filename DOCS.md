# os-bridge Operator Guide

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
- Shell session lifecycle tools

Use `tools/list` for the current live surface instead of relying on hardcoded counts in docs.
