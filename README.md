# os-bridge

BETA v0.0.0

OS-level MCP server for Windows automation and system control over stdio JSON-RPC.

## What It Does

- Exposes local OS automation tools via MCP
- Supports desktop control primitives (mouse, keyboard, windows)
- Includes shell session tools for persistent command execution
- Provides visual helpers including window bounds and screenshots

## Current Versioning Policy

This repository uses incremental beta versioning:

- Start at `0.0.0`
- Every new commit should include:
  - Commit notes (what changed and why)
  - A version bump in `package.json`

Suggested bump flow:

- Patch-level update: `0.0.1`, `0.0.2`, ...
- Minor beta milestone: `0.1.0`, `0.2.0`, ...
- Pre-1.0 stabilization: `0.x.y`

## Requirements

- Node.js 18+
- Windows PowerShell available on PATH

## Install

```powershell
npm install
```

## Run

```powershell
npm start
```

## Test

```powershell
npm test
```

## Git Setup Info

If needed, configure git identity before committing:

```powershell
git config user.name "jross32"
git config user.email "justinwross32@gmail.com"
```

## Notes

- This server is designed to be client-agnostic (works with Claude, Copilot, Codex, or other MCP clients).
- Keep tool behavior generic and avoid app-specific assumptions.
