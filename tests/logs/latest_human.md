# OS-Bridge Test Run
- Timestamp: 2026-05-03T15:07:09.790Z
- Node: v24.14.0
- Platform: win32 10.0.22631

## Summary
- Total: 17
- Passed: 17
- Failed: 0
- Skipped: 0
- Duration (ms): 36826

## Tests
- [PASS] group-a-telemetry/test-get-open-ports (5056 ms)
  - notes: Open ports shape verified
- [PASS] group-a-telemetry/test-get-processes (10512 ms)
  - notes: Process query respected limit and row shape
- [PASS] group-a-telemetry/test-get-screen-size (1270 ms)
  - notes: Screen metrics shape validated
- [PASS] group-a-telemetry/test-get-system-info (3851 ms)
  - notes: System info keys present
- [PASS] group-b-file-ops/test-file-ops-scenario (75 ms)
  - notes: file-ops-demo: scenario valid, catalog updated, MCP round-trip write→read→list all pass
- [PASS] group-b-file-ops/test-get-env-vars (4 ms)
  - notes: get_environment_vars: all-mode, prefix-filter, and named-lookup all work
- [PASS] group-b-file-ops/test-list-directory (10 ms)
  - notes: list_directory: flat list, filter, recursive, and error case all pass
- [PASS] group-b-file-ops/test-open-url (1 ms)
  - notes: open_url: bad-URL rejection validated; real launch skipped (pass --dangerous to enable)
- [PASS] group-b-file-ops/test-read-file (2 ms)
  - notes: read_file returned correct content
- [PASS] group-b-file-ops/test-write-file (5 ms)
  - notes: write_file created and appended correctly; verified via read_file
- [PASS] group-c-input-control/test-move-mouse-gates (3 ms)
  - notes: move_mouse correctly blocked by both safety gates
- [PASS] group-e-control-state/test-control-state-transitions (5 ms)
  - notes: Control state transitions behaved as expected
- [PASS] group-e-control-state/test-execution-profile (1 ms)
  - notes: Execution profile mode toggling verified
- [PASS] group-f-visual/test-get-window-rect (5264 ms)
  - notes: get_window_rect: error case and shape validation passed
- [PASS] group-f-visual/test-screenshot-window (7226 ms)
  - notes: screenshot_window: fallback + real window capture both pass
- [PASS] group-g-shell-sessions/test-shell-session-lifecycle (1361 ms)
  - notes: shell_open / shell_send / shell_read / shell_list_sessions / shell_close all pass
- [PASS] integration/test-clipboard-roundtrip (1953 ms)
  - notes: Clipboard roundtrip succeeded
