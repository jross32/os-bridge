# os-bridge

Windows-only MCP server for desktop automation, shell execution, screenshots, clipboard access, process inspection, and file operations.

## What It Is

- A product MCP server for operating the local Windows environment
- Useful for AI-assisted desktop workflows that need real OS access instead of repository-only tooling
- Designed to work over stdio MCP, with an optional HTTP helper server for health/docs/tool inspection

## Safety Model

- Some tools are observational and safe by default
- Some tools are visibly interactive and can move the mouse, type, focus windows, or launch apps
- Dangerous tests are opt-in because they can affect the live desktop state

## Quick Start

```powershell
npm install
npm start
```

Optional HTTP helper server:

```powershell
npm run http
```

## Testing

```powershell
npm run check
npm test
npm run test:dangerous
npm run ux:smoke
npm run ux:visible
npm run ux:agent-mode
```

## Runtime Discovery

- Use `tools/list` and `prompts/list` for the live MCP surface
- Use the HTTP helper endpoints `/health`, `/docs`, and `/tools` when running `npm run http`

## More Detail

- Operator guide: [DOCS.md](DOCS.md)
- Workspace context: [../README.md](../README.md)
