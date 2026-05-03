# os-bridge tests

This folder validates MCP tools in `mcp-server.js` with repeatable regression artifacts.

## Structure

- Each test lives in its own folder.
- Each test folder includes:
  - `TEST_SPEC.md` — purpose, cases, expected output.
  - `test.js` — executable test logic.
  - `last_result.json` — latest per-test output artifact (auto-generated).
- Run-level outputs are written to:
  - `logs/latest_ai.json`
  - `logs/latest_human.md`
  - `logs/runs/<timestamp>/`

## Run

- Safe suite:
  - `npm test`
- Include dangerous tools (`run_command`, `kill_process` style tests):
  - `npm run test:dangerous`

## Output Contract

- `latest_ai.json` is machine-readable and diffable.
- `latest_human.md` is concise for fast review.
- `last_result.json` in each test folder contains only the newest result for that test.

## Notes

- Dangerous tests are opt-in by design.
- Control state is normalized before each test (`reset_emergency_stop`, `resume_control`).
