# MCP Tool Standards

Use this checklist for every new tool in this server.

## Required Changes

1. Define the tool in `TOOLS` with `name`, `description`, and strict `inputSchema`.
2. Add dispatch in `handleTool()`.
3. Implement a dedicated function with explicit input validation and clear errors.
4. Keep tool names stable and response shapes backward-compatible unless version bump is intentional.

## Testing Requirements

For each new tool, add tests that cover:

- success response shape and key fields
- invalid input handling (missing/invalid args)
- failure behavior (timeouts, not found, process errors)

All tests must pass:

```powershell
npm run check
npm test
```

## Reliability Rules

- Use timeout controls for child process and shell interactions.
- Ensure spawned processes are cleaned up in `finally` paths.
- Clip or structure output clearly for large responses.
- Avoid hidden side effects unless the tool is explicitly stateful.

## Versioning + Commits

- Bump `package.json` on each meaningful update.
- Use commit notes format:
  - Changed
  - Bugs fixed
  - Version bump
