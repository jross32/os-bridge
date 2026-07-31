# Reflex release checklist

Use this checklist for every meaningful Reflex update. A release is complete only when its executable behavior, documentation, and regression evidence agree.

## Before changing code

- [ ] Read the README, operator guide, tool standards, and relevant test specs.
- [ ] Identify the risk level of the change: read-only, mutation, visible input, process/service control, or shell execution.
- [ ] Decide whether existing MCP consumers need a compatibility note or a deprecation path.

## Implementation

- [ ] Implement the smallest coherent behavior change.
- [ ] Validate user/tool inputs before OS interaction.
- [ ] Add bounded timeouts and cleanup for new processes, files, timers, or sessions.
- [ ] Preserve visible-input lease checks for mouse, keyboard, scroll, drag, and window-input behavior.
- [ ] Keep secrets and sensitive tool output out of logs and error messages where feasible.

## Tests

- [ ] Add or update a focused executable test and its `TEST_SPEC.md`.
- [ ] Run `npm run check`.
- [ ] Run `npm test`.
- [ ] Run `npm run test:dangerous` when command execution, process/service management, or another live-machine capability changed.
- [ ] Run the relevant UX scenario when visible input, windows, cursor behavior, or the control overlay changed.
- [ ] If a test is environment-dependent, record the failure and cause; do not represent it as a pass.

## Documentation

- [ ] Update `README.md` for installation, capabilities, integration, or safety-boundary changes.
- [ ] Update `DOCS.md` with the operator workflow, verification method, and recovery path.
- [ ] Update `MCP_TOOL_STANDARDS.md` if a contribution or compatibility rule changed.
- [ ] Update `tests/README.md` when test artifacts, safety modes, or commands changed.
- [ ] Update `SECURITY.md` when the threat model, data exposure, network posture, or reporting process changed.

## Version, commit, and publish

- [ ] Bump `package.json` for any meaningful released behavior or documentation package change.
- [ ] Review `git diff --check` and `git status --short`; do not stage generated logs or unrelated local artifacts.
- [ ] Commit with the repository template, including Changed, Bugs fixed, and Version bump sections.
- [ ] Push only after the staged diff is understood and the relevant checks have completed.
- [ ] Create a release/tag only when the version, notes, and verification evidence are ready.

## New tool minimum

- [ ] Tool metadata in `TOOLS`
- [ ] Dispatcher case and dedicated implementation
- [ ] Strict input schema and stable structured result
- [ ] Appropriate risk classification and visible-input gating where applicable
- [ ] Success, invalid-input, and failure-path tests
- [ ] README/operator-guide documentation
