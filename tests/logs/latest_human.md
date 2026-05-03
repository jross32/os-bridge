# OS-Bridge Test Run
- Timestamp: 2026-05-03T16:41:04.185Z
- Node: v24.14.0
- Platform: win32 10.0.22631

## Summary
- Total: 22
- Passed: 21
- Failed: 1
- Skipped: 0
- Duration (ms): 68185

## Tests
- [PASS] group-a-telemetry/test-get-open-ports (6560 ms)
  - notes: Open ports shape verified
- [PASS] group-a-telemetry/test-get-processes (9656 ms)
  - notes: Process query respected limit and row shape
- [PASS] group-a-telemetry/test-get-screen-size (1174 ms)
  - notes: Screen metrics shape validated
- [PASS] group-a-telemetry/test-get-system-info (3585 ms)
  - notes: System info keys present
- [PASS] group-b-file-ops/test-file-ops-scenario (162 ms)
  - notes: file-ops-demo: scenario valid, catalog updated, MCP round-trip write→read→list all pass
- [PASS] group-b-file-ops/test-get-env-vars (7 ms)
  - notes: get_environment_vars: all-mode, prefix-filter, and named-lookup all work
- [PASS] group-b-file-ops/test-list-directory (23 ms)
  - notes: list_directory: flat list, filter, recursive, and error case all pass
- [PASS] group-b-file-ops/test-open-url (2 ms)
  - notes: open_url: bad-URL rejection validated; real launch skipped (pass --dangerous to enable)
- [PASS] group-b-file-ops/test-read-file (6 ms)
  - notes: read_file returned correct content
- [PASS] group-b-file-ops/test-write-file (12 ms)
  - notes: write_file created and appended correctly; verified via read_file
- [PASS] group-c-input-control/test-move-mouse-gates (5 ms)
  - notes: move_mouse correctly blocked by both safety gates
- [PASS] group-e-control-state/test-control-state-transitions (6 ms)
  - notes: Control state transitions behaved as expected
- [PASS] group-e-control-state/test-execution-profile (3 ms)
  - notes: Execution profile mode toggling verified
- [FAIL] group-f-visual/test-get-window-rect (7638 ms)
  - error: get_window_rect failed for 'Web Scraper MCP - Tool Reference - Google Chrome': Error in get_window_rect: No window found matching: Web Scraper MCP - To
At C:\Users\justi\AppData\Local\Temp\osb_1777826422518_p0590ccno3j.ps1:13 char:19
+ ... not $proc) { throw "No window found matching: Web Scraper MCP - To" }
+                  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : OperationStopped: (No window found...craper MCP - To:String) [], RuntimeException
    + FullyQualifiedErrorId : No window found matching: Web Scraper MCP - To
- [PASS] group-f-visual/test-screenshot-window (8166 ms)
  - notes: screenshot_window: fallback + real window capture both pass
- [PASS] group-g-shell-sessions/test-shell-session-lifecycle (1212 ms)
  - notes: shell_open / shell_send / shell_read / shell_list_sessions / shell_close all pass
- [PASS] group-h-process-intel (14992 ms)
  - notes: Process intelligence tools returned expected structures and wait/process checks passed
- [PASS] group-i-window-intel (6515 ms)
  - notes: Window intelligence tools returned expected structures
- [PASS] group-j-file-intel (24 ms)
  - notes: File system intelligence tools all returned expected structures
- [PASS] group-k-diagnostics (6056 ms)
  - notes: check_service_status: Spooler found, status=Running; check_service_status: missing service correctly returned found=false; get_installed_software: 5 Microsoft entries found; get_startup_items: 9 startup items; get_event_log_entries: 5 Application log entries
- [PASS] group-l-prompts (3 ms)
  - notes: prompts/list: 5 prompts found; prompts/get automate_app: correct structure and interpolation; prompts/get find_memory_hogs: returned workflow message; prompts/get monitor_file: filePath interpolated correctly; prompts/get unknown: error correctly returned
- [PASS] integration/test-clipboard-roundtrip (1946 ms)
  - notes: Clipboard roundtrip succeeded
