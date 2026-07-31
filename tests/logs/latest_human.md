# Reflex Test Run
- Timestamp: 2026-07-31T13:20:03.322Z
- Node: v24.14.0
- Platform: win32 10.0.26200

## Summary
- Total: 24
- Passed: 23
- Failed: 1
- Skipped: 0
- Duration (ms): 66775

## Tests
- [PASS] group-a-telemetry/test-get-open-ports (3824 ms)
  - notes: Open ports shape verified
- [PASS] group-a-telemetry/test-get-processes (1675 ms)
  - notes: Process query respected limit and row shape
- [PASS] group-a-telemetry/test-get-screen-size (1107 ms)
  - notes: Screen metrics shape validated
- [PASS] group-a-telemetry/test-get-system-info (3418 ms)
  - notes: System info keys present
- [PASS] group-b-file-ops/test-file-ops-scenario (97 ms)
  - notes: file-ops-demo: scenario valid, catalog updated, MCP round-trip write→read→list all pass
- [PASS] group-b-file-ops/test-get-env-vars (8 ms)
  - notes: get_environment_vars: all-mode, prefix-filter, and named-lookup all work
- [PASS] group-b-file-ops/test-list-directory (22 ms)
  - notes: list_directory: flat list, filter, recursive, and error case all pass
- [PASS] group-b-file-ops/test-open-url (3 ms)
  - notes: open_url: bad-URL rejection validated; real launch skipped (pass --dangerous to enable)
- [PASS] group-b-file-ops/test-read-file (7 ms)
  - notes: read_file returned correct content
- [PASS] group-b-file-ops/test-write-file (11 ms)
  - notes: write_file created and appended correctly; verified via read_file
- [PASS] group-c-input-control/test-move-mouse-gates (6 ms)
  - notes: move_mouse correctly blocked by both safety gates
- [PASS] group-e-control-state/test-control-state-transitions (8 ms)
  - notes: Control state transitions behaved as expected
- [PASS] group-e-control-state/test-execution-profile (4 ms)
  - notes: Execution profile mode toggling verified
- [PASS] group-f-visual/test-get-window-rect (4590 ms)
  - notes: get_window_rect: error case and shape validation passed
- [PASS] group-f-visual/test-screenshot-window (7618 ms)
  - notes: screenshot_window: fallback + real window capture both pass
- [PASS] group-g-shell-sessions/test-shell-session-lifecycle (1429 ms)
  - notes: shell_open / shell_send / shell_read / shell_list_sessions / shell_close all pass
- [PASS] group-h-process-intel (8379 ms)
  - notes: Process intelligence tools returned expected structures and wait/process checks passed
- [FAIL] group-i-window-intel (6573 ms)
  - error: focus_window by pid failed: Unable to verify foreground focus for: Settings
At C:\Users\justi\AppData\Local\Temp\osb_1785503971200_3g5wdi1be7b.ps1:101 char:3
+   throw "Unable to verify foreground focus for: $($proc.MainWindowTit ...
+   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : OperationStopped: (Unable to verif...s for: Settings:String) [], RuntimeException
    + FullyQualifiedErrorId : Unable to verify foreground focus for: Settings
- [PASS] group-j-file-intel (45 ms)
  - notes: File system intelligence tools all returned expected structures
- [PASS] group-k-diagnostics (8387 ms)
  - notes: check_service_status: Spooler found, status=Running; check_service_status: missing service correctly returned found=false; get_installed_software: 5 Microsoft entries found; get_startup_items: 12 startup items; get_event_log_entries: 5 Application log entries
- [PASS] group-l-prompts (5 ms)
  - notes: prompts/list: 6 prompts found; prompts/get automate_app: correct structure and interpolation; prompts/get find_memory_hogs: returned workflow message; prompts/get monitor_file: filePath interpolated correctly; prompts/get unknown: error correctly returned
- [PASS] group-m-contracts (5729 ms)
  - notes: write_file required-arg validation envelope passed; enum validation check passed; additionalProperties enforcement passed; success structured envelope passed; image metadata envelope passed; unknown tool envelope passed
- [PASS] group-n-workflows (11612 ms)
  - notes: workflow happy path passed; workflow continueOnError path passed; workflow stopOnFail path passed; workflow recursion guard passed; workflow watch-mode gating passed; workflow watch-mode override passed; continuous_mcp_improvement prompt listed
- [PASS] integration/test-clipboard-roundtrip (1756 ms)
  - notes: Clipboard roundtrip succeeded
