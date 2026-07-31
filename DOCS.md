# Reflex operator guide

Reflex gives an MCP client a supervised way to work with a Windows desktop and the local operating system. It is useful when a task involves native applications, installed tools, local processes, or the visible desktop—not just code in a repository or a website’s DOM.

This guide describes how to operate Reflex safely and predictably. For installation and MCP configuration, start with the [README](README.md).

## Mental model

Reflex has three distinct surfaces:

1. **stdio MCP server** — the execution surface. An AI client launches `node mcp-server.js`, then calls MCP tools and prompts.
2. **Windows integration** — PowerShell and Windows APIs used by individual tools to inspect the machine or interact with the desktop.
3. **Optional HTTP helper** — a read-only, unauthenticated discovery catalog at `/health`, `/tools`, and `/docs`; it is not an execution API.

The server runs as the Windows user that launches it. It does not elevate privileges and does not isolate an AI from the user’s data. Plan tasks accordingly.

## Choose the right interface

Use the least powerful interface that can complete the work:

| Situation | Preferred approach |
| --- | --- |
| A product has a documented API | Use the API directly |
| A web app exposes a stable DOM/accessibility tree | Use a browser automation tool such as Playwright |
| A command-line program can do the job | Use a bounded, reviewed command or shell session |
| A native Windows app must be inspected or driven | Use Reflex windows/screenshots and, only when needed, a visible control lease |

This ordering matters: structured interfaces are easier to verify, less sensitive to layout changes, and usually safer than screen coordinates.

## Tool families and risk

Tool names and schemas evolve; use `tools/list` before building a workflow. The following groups describe the current design, not a frozen count.

| Family | Typical tools | Default risk |
| --- | --- | --- |
| Observation | `get_system_info`, `get_processes`, `get_open_ports`, `get_disk_usage`, `system_health_check` | Low, but output can be sensitive |
| File intelligence | `read_file`, `read_file_lines`, `grep_file`, `hash_file`, `find_in_files`, `file_info` | Low to medium; files may contain secrets |
| File mutation | `write_file`, `copy_file`, `move_file`, `delete_file`, `archive_extract` | High; `delete_file` requires `confirm: true` |
| Windows and display | `list_windows_detailed`, `get_focused_app_state`, `screenshot_window`, `focus_window`, `move_resize_window` | Medium to high; screenshots and focus can reveal or disrupt work |
| Visible input | `move_mouse`, `click_mouse`, `drag_mouse`, `scroll`, `type_text`, `press_key` | High; requires an active input lease |
| Process and service control | `kill_process`, `bulk_kill_processes`, `manage_service` | High to critical; use dry-run/preflight when available |
| Shell execution | `run_command`, `shell_open`, `shell_send`, `shell_close` | Critical; commands have the user’s account permissions |
| Network and environment | `ping_host`, `check_port_open`, `get_network_adapters`, `get_environment_vars` | Medium; output may reveal internal topology or credentials |
| Workflow orchestration | `workflow_runbook_execute`, execution-profile and control-state tools | Depends on each step’s tool risk |

## Visible control lease

### Starting control

Call `request_control` before visible input. Provide a recognizable `agentName` when the client does not supply one. Reflex displays that name in the topmost control strip.

The lease gates the mouse, keyboard, scrolling, dragging, text entry, keypress, and relevant window-input functions. A rejected, paused, released, or emergency-stopped lease blocks those tools with a structured error.

### Human takeover

The person at the machine can pause, resume, release, or emergency-stop the lease from the strip. A physical Esc key triggers the same sticky emergency stop; an AI cannot simulate that key to bypass or manufacture a stop. If the strip ends unexpectedly, Reflex revokes control rather than continuing invisibly.

### Ending control

Call `release_control` as soon as the visible job is complete. Treat a lease as a short-lived capability, not a session-wide permission.

`reset_emergency_stop` deliberately clears an emergency state. It should be performed only after a person understands why the stop occurred.

## Persistent shell sessions

Use persistent sessions only when state between commands matters.

1. `shell_open` chooses PowerShell (default) or `cmd.exe`, and returns a `sessionId`.
2. `shell_send` runs a command in that session and returns stdout/stderr collected since the prior send.
3. `shell_read` checks buffered output without sending a command; `clear: true` clears the buffers afterward.
4. `shell_close` destroys the session. `shell_list_sessions` identifies sessions that remain open.

Every opened session consumes a child process. Close it in normal completion and error paths. Set bounded timeouts; do not use a persistent session as an unattended background executor.

## Workflow runbooks

`workflow_runbook_execute` runs a bounded list of tool steps with limits, retries, optional continuation after an error, and risk-aware approval pauses. It is useful for short, inspectable runbooks—not an excuse to grant an agent unlimited autonomy.

For each step, specify the tool and arguments. Add a clear note, a timeout, and `requiresConfirmation: true` for any meaningful change. In watch mode, Reflex pauses steps whose risk exceeds the current auto-approval threshold. Inspect the returned step-by-step result before continuing.

Good runbook pattern:

1. Observe current state.
2. Validate the target identity and expected precondition.
3. Request confirmation for the mutation.
4. Make one mutation.
5. Verify the actual postcondition with an independent observation tool.

## Data handling

Tool outputs can contain personal or sensitive material: clipboard text, environment variables, user/session data, file contents, screenshots, process command lines, Wi-Fi names, and network information.

- Do not paste raw results into public issue trackers or logs.
- Do not expose the helper’s port via a tunnel or public network.
- Avoid reading broad folders or all environment variables when a narrow file, name, or prefix will do.
- Before an action that could upload/send data, ask a person for explicit approval.

## Common failure modes

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Input tool says no lease is active | Visible control was never requested or was released | Call `request_control`, then retry the smallest action |
| Input tool says paused/emergency-stopped | A person paused control or stopped it | Do not reset automatically; inspect `get_control_state` and ask the person |
| Window target is wrong or ambiguous | A title match found more than one app | Use `list_windows_detailed`; target by PID or handle where possible |
| Screenshot does not show expected state | App focus, display scaling, or window timing changed | Inspect focused-window state, wait, then capture the exact window again |
| Shell output is incomplete | Command is still running or exceeded a timeout | Use a bounded command, `shell_read`, and verify the exit state; avoid guessing success |
| HTTP helper is unreachable | Wrong port or server not started with `--http` | Start `npm run http`; check `REFLEX_HEALTH_PORT` if customized |

## Safe test modes

`npm test` is the regression suite intended for normal use. `npm run test:dangerous` includes tests for capabilities such as command/process control. UX scenarios can deliberately affect the visible desktop. Run them only on a machine and session where that is acceptable.

For unattended test automation only, `REFLEX_DISABLE_OVERLAY=1` disables the control strip while retaining lease state checks. It is not an operational safety setting.

## MCP discovery

Use MCP-native discovery whenever possible:

- `tools/list` returns tool definitions and schemas.
- `prompts/list` returns available guided prompts.
- `prompts/get` returns a selected prompt with its arguments filled in.
- `reflex_meta` summarizes the live Reflex instance.

The HTTP `/tools` endpoint intentionally returns only a lightweight catalog; it is convenient for a human dashboard but does not replace the MCP schema surface.
