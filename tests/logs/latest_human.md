# OS-Bridge Test Run
- Timestamp: 2026-05-03T16:37:23.464Z
- Node: v24.14.0
- Platform: win32 10.0.22631

## Summary
- Total: 21
- Passed: 20
- Failed: 1
- Skipped: 0
- Duration (ms): 70681

## Tests
- [PASS] group-a-telemetry/test-get-open-ports (6994 ms)
  - notes: Open ports shape verified
- [PASS] group-a-telemetry/test-get-processes (9923 ms)
  - notes: Process query respected limit and row shape
- [PASS] group-a-telemetry/test-get-screen-size (1357 ms)
  - notes: Screen metrics shape validated
- [PASS] group-a-telemetry/test-get-system-info (3995 ms)
  - notes: System info keys present
- [PASS] group-b-file-ops/test-file-ops-scenario (162 ms)
  - notes: file-ops-demo: scenario valid, catalog updated, MCP round-trip write→read→list all pass
- [PASS] group-b-file-ops/test-get-env-vars (7 ms)
  - notes: get_environment_vars: all-mode, prefix-filter, and named-lookup all work
- [PASS] group-b-file-ops/test-list-directory (18 ms)
  - notes: list_directory: flat list, filter, recursive, and error case all pass
- [PASS] group-b-file-ops/test-open-url (2 ms)
  - notes: open_url: bad-URL rejection validated; real launch skipped (pass --dangerous to enable)
- [PASS] group-b-file-ops/test-read-file (4 ms)
  - notes: read_file returned correct content
- [PASS] group-b-file-ops/test-write-file (7 ms)
  - notes: write_file created and appended correctly; verified via read_file
- [PASS] group-c-input-control/test-move-mouse-gates (5 ms)
  - notes: move_mouse correctly blocked by both safety gates
- [PASS] group-e-control-state/test-control-state-transitions (7 ms)
  - notes: Control state transitions behaved as expected
- [PASS] group-e-control-state/test-execution-profile (4 ms)
  - notes: Execution profile mode toggling verified
- [FAIL] group-f-visual/test-get-window-rect (7520 ms)
  - error: get_window_rect failed for 'Web Scraper MCP - Tool Reference - Google Chrome': Error in get_window_rect: No window found matching: Web Scraper MCP - To
At C:\Users\justi\AppData\Local\Temp\osb_1777826200466_iu7jlegd25s.ps1:13 char:19
+ ... not $proc) { throw "No window found matching: Web Scraper MCP - To" }
+                  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : OperationStopped: (No window found...craper MCP - To:String) [], RuntimeException
    + FullyQualifiedErrorId : No window found matching: Web Scraper MCP - To
- [PASS] group-f-visual/test-screenshot-window (7869 ms)
  - notes: screenshot_window: fallback + real window capture both pass
- [PASS] group-g-shell-sessions/test-shell-session-lifecycle (1311 ms)
  - notes: shell_open / shell_send / shell_read / shell_list_sessions / shell_close all pass
- [PASS] group-h-process-intel (15734 ms)
  - notes: Process intelligence tools returned expected structures and wait/process checks passed
- [PASS] group-i-window-intel (6019 ms)
  - notes: Window intelligence tools returned expected structures
- [PASS] group-j-file-intel (15 ms)
  - notes: File system intelligence tools all returned expected structures
- [PASS] group-k-diagnostics (7338 ms)
  - notes: check_service_status: Spooler found, status=Running; check_service_status: missing service correctly returned found=false; get_installed_software: 5 Microsoft entries found; get_startup_items: 9 startup items; get_event_log_entries: 5 Application log entries
- [PASS] integration/test-clipboard-roundtrip (1949 ms)
  - notes: Clipboard roundtrip succeeded
