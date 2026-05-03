# OS-Bridge Test Run
- Timestamp: 2026-05-03T16:33:49.429Z
- Node: v24.14.0
- Platform: win32 10.0.22631

## Summary
- Total: 20
- Passed: 19
- Failed: 1
- Skipped: 0
- Duration (ms): 61645

## Tests
- [PASS] group-a-telemetry/test-get-open-ports (6111 ms)
  - notes: Open ports shape verified
- [PASS] group-a-telemetry/test-get-processes (10056 ms)
  - notes: Process query respected limit and row shape
- [PASS] group-a-telemetry/test-get-screen-size (1269 ms)
  - notes: Screen metrics shape validated
- [PASS] group-a-telemetry/test-get-system-info (3792 ms)
  - notes: System info keys present
- [PASS] group-b-file-ops/test-file-ops-scenario (170 ms)
  - notes: file-ops-demo: scenario valid, catalog updated, MCP round-trip write→read→list all pass
- [PASS] group-b-file-ops/test-get-env-vars (7 ms)
  - notes: get_environment_vars: all-mode, prefix-filter, and named-lookup all work
- [PASS] group-b-file-ops/test-list-directory (20 ms)
  - notes: list_directory: flat list, filter, recursive, and error case all pass
- [PASS] group-b-file-ops/test-open-url (3 ms)
  - notes: open_url: bad-URL rejection validated; real launch skipped (pass --dangerous to enable)
- [PASS] group-b-file-ops/test-read-file (4 ms)
  - notes: read_file returned correct content
- [PASS] group-b-file-ops/test-write-file (8 ms)
  - notes: write_file created and appended correctly; verified via read_file
- [PASS] group-c-input-control/test-move-mouse-gates (7 ms)
  - notes: move_mouse correctly blocked by both safety gates
- [PASS] group-e-control-state/test-control-state-transitions (7 ms)
  - notes: Control state transitions behaved as expected
- [PASS] group-e-control-state/test-execution-profile (2 ms)
  - notes: Execution profile mode toggling verified
- [FAIL] group-f-visual/test-get-window-rect (8291 ms)
  - error: get_window_rect failed for 'Web Scraper MCP - Tool Reference - Google Chrome': Error in get_window_rect: No window found matching: Web Scraper MCP - To
At C:\Users\justi\AppData\Local\Temp\osb_1777825995264_ime9thbjc3b.ps1:13 char:19
+ ... not $proc) { throw "No window found matching: Web Scraper MCP - To" }
+                  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : OperationStopped: (No window found...craper MCP - To:String) [], RuntimeException
    + FullyQualifiedErrorId : No window found matching: Web Scraper MCP - To
- [PASS] group-f-visual/test-screenshot-window (6618 ms)
  - notes: screenshot_window: fallback + real window capture both pass
- [PASS] group-g-shell-sessions/test-shell-session-lifecycle (1203 ms)
  - notes: shell_open / shell_send / shell_read / shell_list_sessions / shell_close all pass
- [PASS] group-h-process-intel (14815 ms)
  - notes: Process intelligence tools returned expected structures and wait/process checks passed
- [PASS] group-i-window-intel (6603 ms)
  - notes: Window intelligence tools returned expected structures
- [PASS] group-j-file-intel (32 ms)
  - notes: File system intelligence tools all returned expected structures
- [PASS] integration/test-clipboard-roundtrip (2030 ms)
  - notes: Clipboard roundtrip succeeded
