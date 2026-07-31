# Reflex security policy

## Security model

Reflex is a local Windows MCP server. It executes with the permissions of the Windows user that launches it and is intended for a trusted, supervised AI client.

It can expose or affect local state, including files, clipboard contents, environment data, processes, services, windows, screenshots, and shell commands. The visible-control lease protects against unattended mouse/keyboard/window-input use; it does **not** sandbox every other tool family.

## Deployment guidance

- Run Reflex only for a trusted local MCP client.
- Use a separate, low-privilege Windows account or disposable VM for untrusted browsing or high-risk automation.
- Do not connect Reflex to a public, shared, or anonymously reachable MCP endpoint.
- Do not use `REFLEX_DISABLE_OVERLAY=1` outside non-interactive testing.
- Treat screenshots, clipboard output, environment variables, shell output, and file content as sensitive data.
- Keep the optional HTTP discovery helper private. It is unauthenticated and intended for local inspection, not remote access.
- Ask a person before actions that transmit data, modify accounts, install software, alter services, delete content, or have financial/legal consequences.

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the repository owner rather than opening a public issue with exploit details. Include:

- affected Reflex version and Windows version
- a minimal reproduction or proof of concept
- the expected and observed behavior
- whether the issue can expose data, bypass visible-control safety, or execute an unintended action

The maintainer will acknowledge the report, assess impact, and coordinate a fix and disclosure timeline.

## Scope notes

The current HTTP helper exposes a read-only catalog (`/health`, `/tools`, and `/docs`) and does not execute MCP tools. It should nevertheless be considered local-only because it provides service metadata and an inventory of capabilities.
