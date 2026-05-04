# os-bridge — AI Tool Reference (DOCS.md)

Version: **0.1.0** | Protocol: stdio | Tools: **~65** | Prompts: 0

> **For AI agents:** This is your Windows OS control interface. Use it to read/write files, run shell commands, manage processes and windows, control the mouse/keyboard, capture screenshots, and monitor system state. Requires Windows; most tools use native PowerShell or Win32 APIs under the hood.

---

## Quick Picks by Goal

| Goal | Tool to Use |
|------|-------------|
| Run a shell command | `run_command` |
| Read a file | `read_file` |
| Write a file | `write_file` |
| List a directory | `list_directory` |
| Take a screenshot | `take_screenshot` |
| Get running processes | `get_processes` |
| Kill a process | `kill_process` |
| Focus a window | `focus_window` |
| Move/resize a window | `move_resize_window` |
| Type text into a window | `type_text` |
| Read clipboard | `read_clipboard` |
| Write clipboard | `write_clipboard` |
| Get system info | `get_system_info` |
| Watch a file for changes | `watch_file_changes` |
| Open a URL in browser | `open_url` |

---

## Window Selector Pattern
All window-targeting tools accept one of three selectors — pass exactly one:
```json
{ "title": "Notepad" }      // match by window title (partial, case-insensitive)
{ "pid": 12345 }            // match by process ID
{ "hwnd": 987654 }          // match by window handle (most precise)
```

---

## All Tools by Category

### System Information

#### `get_system_info`
Get OS version, CPU, RAM, uptime, hostname.
```json
{}
```
Returns: `{ os, cpu, ram, uptime, hostname }`

#### `get_environment_vars`
Read environment variables from the current process.
```json
{ "filter": "PATH" }  // optional substring filter
```
Returns: `{ vars: { KEY: value } }`

#### `get_screen_size`
Get the display resolution.
```json
{}
```
Returns: `{ width, height }`

#### `get_installed_software`
List installed programs (from registry).
```json
{}
```
Returns: `{ count, software: [{ name, version, publisher }] }`

#### `get_startup_items`
List programs that run at startup.
```json
{}
```
Returns: `{ items: [{ name, command, location }] }`

#### `get_event_log_entries`
Read Windows Event Log entries (Application/System/Security).
```json
{ "logName": "Application", "entryType": "Error", "count": 20 }
```
Returns: `{ entries: [{ time, source, message }] }`

#### `get_open_ports`
List open TCP/UDP ports and their associated processes.
```json
{}
```
Returns: `{ ports: [{ port, protocol, pid, processName, state }] }`

#### `check_service_status`
Check the status of a Windows service.
```json
{ "serviceName": "wuauserv" }
```
Returns: `{ name, status, startType }`

---

### Process Management

#### `get_processes`
List running processes with CPU/memory stats.
```json
{ "filter": "node" }  // optional name filter
```
Returns: `{ processes: [{ pid, name, cpu, memory, path }] }`

#### `process_resource_hotspots`
Find top N processes by CPU or memory usage.
```json
{ "by": "memory", "topN": 10 }
```
Returns: `{ top: [{ pid, name, value }] }`

#### `find_memory_hogs`
Find processes consuming the most memory above a threshold (MB).
```json
{ "thresholdMb": 500 }
```
Returns: `{ hogs: [{ pid, name, memoryMb }] }`

#### `process_tree`
Show parent-child process hierarchy.
```json
{ "rootPid": 1234 }
```
Returns: `{ tree: { pid, name, children: [...] } }`

#### `process_network_map`
Map processes to their active network connections.
```json
{}
```
Returns: `{ map: [{ pid, name, connections: [{ port, remoteAddr }] }] }`

#### `wait_for_process_state`
Poll until a named process starts or exits (with timeout).
```json
{ "processName": "chrome.exe", "state": "running", "timeoutMs": 10000 }
```
Returns: `{ matched, elapsed, state }`

#### `kill_process`
Terminate a process by PID or name.
```json
{ "pid": 12345 }
// or
{ "name": "notepad.exe" }
```
Returns: `{ killed, pid, name }`

#### `debug_slow_startup`
Analyze startup items and first-run processes to find boot bottlenecks.
```json
{}
```
Returns: `{ analysis, suspects: [...] }`

---

### Window Management

#### `list_windows`
List all visible top-level windows.
```json
{}
```
Returns: `{ windows: [{ hwnd, title, pid, rect }] }`

#### `list_windows_detailed`
List windows with extended metadata (class name, state, size).
```json
{}
```
Returns: `{ windows: [{ hwnd, title, pid, className, isMinimized, rect }] }`

#### `get_active_window`
Get info about the currently focused window.
```json
{}
```
Returns: `{ hwnd, title, pid, rect }`

#### `get_focused_app_state`
Get detailed state of the focused application (process + window).
```json
{}
```
Returns: `{ pid, name, title, hwnd, rect, isMaximized }`

#### `window_hierarchy`
Get the full child-window tree for a parent window.
```json
{ "hwnd": 987654 }
```
Returns: `{ hierarchy: { hwnd, title, children: [...] } }`

#### `get_window_rect`
Get a window's position and size. Accepts title/pid/hwnd selector.
```json
{ "title": "Notepad" }
```
Returns: `{ hwnd, title, x, y, width, height }`

#### `capture_window_state`
Save a snapshot of a window's rect + state for later comparison.
```json
{ "hwnd": 987654, "label": "before-resize" }
```
Returns: `{ label, snapshot: { hwnd, title, rect, isMinimized } }`

#### `screenshot_window`
Take a screenshot of a specific window by selector.
```json
{ "title": "Chrome" }
```
Returns: `{ path, width, height }`

#### `focus_window`
Bring a window to the foreground. Accepts title/pid/hwnd.
```json
{ "title": "VS Code" }
```
Returns: `{ focused, hwnd, title }`

#### `move_resize_window`
Move and/or resize a window. Accepts title/pid/hwnd selector.
```json
{ "hwnd": 987654, "x": 100, "y": 100, "width": 1280, "height": 720 }
```
Returns: `{ moved, hwnd, title, rect }`

#### `minimize_maximize_window`
Minimize or maximize a window. Accepts title/pid/hwnd.
```json
{ "pid": 12345, "action": "maximize" }  // action: "minimize" | "maximize" | "restore"
```
Returns: `{ action, hwnd, title }`

#### `close_window`
Close a window gracefully. Accepts title/pid/hwnd.
```json
{ "title": "Notepad" }
```
Returns: `{ closed, hwnd, title }`

---

### File System

#### `read_file`
Read a text file (or a line range).
```json
{ "filePath": "C:/path/file.txt", "startLine": 1, "endLine": 50 }
```
Returns: `{ content, lineCount }`

#### `write_file`
Write or overwrite a text file.
```json
{ "filePath": "C:/path/file.txt", "content": "hello world" }
```
Returns: `{ written, path }`

#### `list_directory`
List files and subdirectories.
```json
{ "dirPath": "C:/Users/justi", "recursive": false }
```
Returns: `{ entries: [{ name, type, size, modified }] }`

#### `search_files`
Find files matching a name pattern under a directory.
```json
{ "rootDir": "C:/Users/justi/mcp-servers", "pattern": "*.json", "maxDepth": 3 }
```
Returns: `{ files: [{ path, size, modified }] }`

#### `read_file_lines`
Read specific line ranges from a large file efficiently.
```json
{ "filePath": "C:/path/big.log", "startLine": 1000, "endLine": 1020 }
```
Returns: `{ lines: [...], totalLines }`

#### `grep_file`
Search for a pattern inside a file (regex or literal).
```json
{ "filePath": "C:/path/file.js", "pattern": "function handle", "isRegex": true }
```
Returns: `{ matches: [{ line, lineNumber, text }] }`

#### `diff_files`
Compare two files and return unified diff.
```json
{ "fileA": "C:/path/a.js", "fileB": "C:/path/b.js" }
```
Returns: `{ diff, linesAdded, linesRemoved }`

#### `hash_file`
Compute MD5/SHA256 hash of a file.
```json
{ "filePath": "C:/path/file.exe", "algorithm": "sha256" }
```
Returns: `{ hash, algorithm, filePath }`

#### `watch_file_changes`
Poll a file for changes over an interval and return delta.
```json
{ "filePath": "C:/path/log.txt", "intervalSecs": 5, "durationSecs": 30 }
```
Returns: `{ changeCount, changes: [{ timestamp, type, content }] }`

#### `monitor_file`
Start a persistent file monitor (background watcher).
```json
{ "filePath": "C:/path/log.txt", "intervalSecs": 10 }
```
Returns: `{ monitoring, filePath, intervalSecs }`

---

### Shell & Commands

#### `run_command`
Execute a PowerShell command and return stdout/stderr.
```json
{ "command": "Get-Date", "timeoutMs": 15000, "workingDir": "C:/Users/justi" }
```
Returns: `{ stdout, stderr, exitCode, durationMs }`

#### `shell_open`
Open a persistent named shell session.
```json
{ "sessionId": "my-session", "shell": "powershell" }
```
Returns: `{ sessionId, open }`

#### `shell_send`
Send a command to an open shell session.
```json
{ "sessionId": "my-session", "command": "ls" }
```
Returns: `{ sent, sessionId }`

#### `shell_read`
Read buffered output from an open shell session.
```json
{ "sessionId": "my-session", "timeoutMs": 3000 }
```
Returns: `{ output, sessionId }`

#### `shell_close`
Close a named shell session.
```json
{ "sessionId": "my-session" }
```
Returns: `{ closed, sessionId }`

#### `shell_list_sessions`
List all active shell sessions.
```json
{}
```
Returns: `{ sessions: [{ id, shell, open }] }`

#### `shell_open`
Open a browser tab or file with the system default application.
```json
{ "target": "https://github.com/jross32" }
```
Returns: `{ opened, target }`

---

### Input Simulation

#### `type_text`
Type text into the currently focused window.
```json
{ "text": "Hello World", "delayMs": 50 }
```
Returns: `{ typed, chars }`

#### `press_key`
Send a key press (supports modifiers).
```json
{ "key": "ctrl+s" }
```
Returns: `{ pressed, key }`

#### `get_mouse_position`
Get current mouse cursor coordinates.
```json
{}
```
Returns: `{ x, y }`

#### `move_mouse`
Move mouse to absolute coordinates.
```json
{ "x": 500, "y": 400 }
```
Returns: `{ moved, x, y }`

#### `click_mouse`
Click at the current or specified position.
```json
{ "x": 500, "y": 400, "button": "left", "doubleClick": false }
```
Returns: `{ clicked, x, y, button }`

#### `drag_mouse`
Click-drag from one position to another.
```json
{ "fromX": 100, "fromY": 100, "toX": 500, "toY": 400 }
```
Returns: `{ dragged }`

#### `scroll`
Scroll the mouse wheel up or down.
```json
{ "x": 500, "y": 400, "direction": "down", "amount": 3 }
```
Returns: `{ scrolled, direction, amount }`

---

### Screenshot & Capture

#### `take_screenshot`
Capture the full screen or a region.
```json
{ "outputPath": "C:/tmp/screen.png", "region": { "x": 0, "y": 0, "width": 1920, "height": 1080 } }
```
Returns: `{ path, width, height }`

---

### Clipboard

#### `read_clipboard`
Get current clipboard text content.
```json
{}
```
Returns: `{ content }`

#### `write_clipboard`
Set clipboard text content.
```json
{ "content": "Hello from MCP" }
```
Returns: `{ written }`

---

### Notifications

#### `send_notification`
Send a Windows toast notification.
```json
{ "title": "Task Complete", "body": "Your scrape finished successfully." }
```
Returns: `{ sent, title, body }`

---

### Control & Safety

#### `request_control`
Request OS control permissions for automation.
```json
{ "reason": "Running automated window tests" }
```
Returns: `{ granted, reason }`

#### `release_control`
Release OS control back to manual operation.
```json
{}
```
Returns: `{ released }`

#### `pause_control`
Temporarily pause automated control without releasing it.
```json
{}
```
Returns: `{ paused }`

#### `resume_control`
Resume automation after a pause.
```json
{}
```
Returns: `{ resumed }`

#### `emergency_stop`
Immediately halt all automation and release all control.
```json
{}
```
Returns: `{ stopped }`

#### `reset_emergency_stop`
Clear the emergency stop flag to allow automation again.
```json
{}
```
Returns: `{ reset }`

#### `get_control_state`
Get current control state (granted/paused/emergency-stopped).
```json
{}
```
Returns: `{ state, granted, paused, emergencyStopped }`

#### `get_execution_profile`
Get current execution safety profile settings.
```json
{}
```
Returns: `{ profile: { maxCommandTimeMs, allowDestructive, ... } }`

#### `set_execution_profile`
Update execution safety profile settings.
```json
{ "maxCommandTimeMs": 30000, "allowDestructive": false }
```
Returns: `{ updated, profile }`

---

### High-Level / Composite

#### `automate_app`
Goal-directed app automation — describe what you want, the server sequences the steps.
```json
{ "appName": "Notepad", "goal": "Type 'hello world' and save the file" }
```
Returns: `{ success, steps: [...], result }`

#### `workflow_runbook_execute`
Execute a multi-step runbook JSON file sequentially.
```json
{ "runbookPath": "C:/path/runbook.json" }
```
Returns: `{ stepsRun, passed, failed, results: [...] }`

#### `continuous_mcp_improvement`
Run self-improvement cycles on the MCP server (tests → analysis → apply suggestions).
```json
{ "focus": "contracts", "maxCycles": 3 }
```
Returns: `{ cyclesRun, improvements: [...] }`

#### `open_url`
Open a URL in the default browser.
```json
{ "url": "https://github.com/jross32/mcp-servers" }
```
Returns: `{ opened, url }`

---

## Running

```bash
cd os-bridge
npm install
node mcp-server.js        # stdio mode
node tests/run-all.js     # run all test groups
node --check mcp-server.js # syntax check
```

## Windows Requirements
- Windows 10 or later
- PowerShell 5.1+ (built-in on Win10+)
- Node.js 18+
- Optional: `nircmd.exe` in PATH for some notification/input features
