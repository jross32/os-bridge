# Reflex MCP contribution standards

This document is the contract for adding or changing a Reflex tool, prompt, workflow behavior, or transport-facing response. Reflex is an OS-level server: a vague description or weak boundary can become a real user-impacting mistake.

## Tool design checklist

For every new tool:

1. Define it in `TOOLS` with a stable `name`, a concrete description, and an `inputSchema` that rejects unknown fields where practical.
2. Add one dispatcher case in `handleTool()` and implement one dedicated function. Do not bury new behavior inside an unrelated tool.
3. Validate required inputs, ranges, enums, file paths, selectors, and mutually exclusive options before touching the operating system.
4. Return a structured, bounded result whose key fields are useful to both a model and a person. Do not rely on prose-only success messages.
5. Use `ToolContractError` for expected failures so MCP callers receive a stable code, category, retryability signal, suggested action, and safe details.
6. Keep names and successful response shapes backward compatible. A breaking contract requires a version bump, release notes, and a migration explanation.
7. Add the tool to the appropriate documentation family in the README and operator guide.

## Safety classification

Classify the strongest possible effect of a tool, not its usual use:

| Level | Examples | Required design treatment |
| --- | --- | --- |
| Low | Read-only system or status inspection | Bound output and identify sensitive fields |
| Medium | Clipboard writes, focus/resize, limited network checks | Clear description, validation, and observable result |
| High | File mutation, window closing, visible UI input, process changes | Narrow target selectors, preflight/dry-run when possible, explicit success verification |
| Critical | Shell execution, bulk process termination, destructive service control | Tight argument validation, timeouts, actionable errors, dedicated tests, and human-approval compatibility |

Visible mouse, keyboard, scrolling, dragging, and window-input tools must call `checkInputAllowed()` before acting. Do not add a bypass. They must preserve the control-lease guarantee, including pause and emergency stop.

Do not imply that a visible input lease protects unrelated capabilities. Shell, file, clipboard, and process tools need their own least-privilege design and documentation.

## Reliability requirements

- Give child processes and network calls sensible bounded timeouts.
- Clean up spawned processes, temporary files, handles, timers, and persistent-shell state in normal and error paths.
- Prefer a precise PID/window handle/path over a broad title/name pattern.
- Cap large lists, file reads, screenshots, directory walks, and command output. Make truncation explicit in the response.
- Do not silently fall back from an exact destructive target to a looser match.
- For a mutation, return what was changed and use a follow-up observation tool or direct verification when feasible.
- Never log secrets unnecessarily; treat clipboard, environment values, screenshots, and command output as potentially sensitive.

## Workflow and prompt rules

Prompts are guidance, not hidden automation. They must describe assumptions, required confirmation points, and verification steps.

For `workflow_runbook_execute` compatibility:

- Give each step a focused purpose and keep workflows bounded.
- Assign the correct risk or allow Reflex to derive it from the tool.
- Mark consequential steps with `requiresConfirmation: true` and an intelligible `approvalMessage`.
- Avoid recursive workflow invocation and do not create unbounded watch loops.
- Include an independent verification step after each significant mutation.

## Test requirements

Each new or materially changed tool requires tests for:

- a representative successful call and the useful result fields
- required-argument, type/range/enum, and selector validation
- expected OS-level failure behavior (not found, timeout, access failure, process failure)
- safety gating or confirmation behavior when the tool can affect the machine
- output-size handling when the tool can return variable-length data

Place a `TEST_SPEC.md` next to the executable regression test. It should identify the tool, risk, goal, expected fields, and named cases. See [tests/README.md](tests/README.md) for the artifact format.

Run at least:

```powershell
npm run check
npm test
```

Run `npm run test:dangerous` and the relevant visible UX scenario when the change affects command execution, process/service control, clipboard behavior, visible input, windows, or the safety overlay. Report environment-dependent failures honestly rather than editing generated results to make them look green.

## Documentation and release discipline

Before a release, make sure that:

- the README describes a user-visible capability and its important boundary
- `DOCS.md` covers the operating behavior, risks, and recovery path
- `tests/README.md` still accurately describes suite behavior and artifacts
- `RELEASE_CHECKLIST.md` has been followed
- `package.json` has an intentional version bump for a meaningful change

Use the repository’s structured commit template. Keep a change small enough that its documentation, tests, and behavior can be reviewed as one coherent unit.
