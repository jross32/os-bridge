#!/usr/bin/env node
'use strict';

/**
 * os-bridge — MCP server
 * Gives AI agents full OS-level access on Windows:
 *   • System info (CPU/RAM/disk/processes/ports)
 *   • Mouse, keyboard, scroll, drag
 *   • Screenshots
 *   • Window listing, focus, close
 *   • Clipboard read/write
 *   • File search
 *   • Shell command execution
 *   • Control state: pause / resume / emergency-stop
 *
 * Zero npm dependencies — pure Node.js + PowerShell via child_process.
 */

const readline = require('readline');
const { execSync, exec: execCb, spawn } = require('child_process');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');

// ── Persistent shell sessions ─────────────────────────────────────────────────
// Map of sessionId → { proc, outputBuf, errorBuf, exitCode, closed }
const shellSessions = new Map();

function shellOpen(args) {
  const shell = (args.shell === 'cmd') ? 'cmd.exe' : 'powershell.exe';
  const spawnArgs = (shell === 'cmd') ? [] : ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'];
  const cwd = args.cwd ? String(args.cwd) : process.cwd();

  const proc = spawn(shell, spawnArgs, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const sessionId = crypto.randomUUID();
  const session = { proc, outputBuf: '', errorBuf: '', exitCode: null, closed: false, shell, cwd };

  proc.stdout.on('data', (d) => { session.outputBuf += d.toString('utf8'); });
  proc.stderr.on('data', (d) => { session.errorBuf  += d.toString('utf8'); });
  proc.on('close', (code) => { session.exitCode = code; session.closed = true; });

  shellSessions.set(sessionId, session);
  return { sessionId, shell, cwd, pid: proc.pid };
}

async function shellSend(args) {
  if (!args.sessionId) throw new Error('sessionId required');
  if (!args.command)   throw new Error('command required');
  const session = shellSessions.get(args.sessionId);
  if (!session)         throw new Error(`No session: ${args.sessionId}`);
  if (session.closed)   throw new Error(`Session ${args.sessionId} is closed`);

  // Clear buffers before sending so read returns only new output
  session.outputBuf = '';
  session.errorBuf  = '';

  const timeoutMs = Number.isFinite(args.timeoutMs) ? args.timeoutMs : 8000;
  const sentinel  = `__OS_BRIDGE_DONE_${crypto.randomUUID().replace(/-/g, '')}__`;

  // For PowerShell: append sentinel echo after command. For cmd: use & echo.
  const marker = session.shell === 'cmd'
    ? `${args.command}\r\necho ${sentinel}\r\n`
    : `${args.command}\nWrite-Output '${sentinel}'\n`;

  session.proc.stdin.write(marker);

  // Wait until sentinel appears in stdout or timeout
  await new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    function check() {
      if (session.closed) return resolve();
      if (session.outputBuf.includes(sentinel)) return resolve();
      if (Date.now() >= deadline) return resolve();
      setTimeout(check, 100);
    }
    setTimeout(check, 100);
  });

  // Strip sentinel (and the PS prompt line that follows) from output
  let stdout = session.outputBuf;
  const sentinelIdx = stdout.indexOf(sentinel);
  if (sentinelIdx !== -1) stdout = stdout.slice(0, sentinelIdx);
  // Trim trailing PS prompt line  (e.g. "PS C:\...> ")
  stdout = stdout.replace(/\r?\nPS [^>]+>\s*$/, '').replace(/^PS [^>]+>\s*/m, '');

  return {
    stdout: stdout.trimEnd(),
    stderr: session.errorBuf.trimEnd(),
    closed: session.closed,
    exitCode: session.exitCode,
    timedOut: !session.outputBuf.includes(sentinel) && !session.closed,
  };
}

function shellRead(args) {
  if (!args.sessionId) throw new Error('sessionId required');
  const session = shellSessions.get(args.sessionId);
  if (!session) throw new Error(`No session: ${args.sessionId}`);
  const out = { stdout: session.outputBuf, stderr: session.errorBuf, closed: session.closed, exitCode: session.exitCode };
  if (args.clear) { session.outputBuf = ''; session.errorBuf = ''; }
  return out;
}

function shellClose(args) {
  if (!args.sessionId) throw new Error('sessionId required');
  const session = shellSessions.get(args.sessionId);
  if (!session) return { closed: true, note: 'Session not found (already removed)' };
  if (!session.closed) {
    try { session.proc.stdin.end(); } catch {}
    try { session.proc.kill(); }     catch {}
  }
  shellSessions.delete(args.sessionId);
  return { closed: true, sessionId: args.sessionId };
}

function shellListSessions() {
  const sessions = [];
  for (const [id, s] of shellSessions) {
    sessions.push({ sessionId: id, shell: s.shell, cwd: s.cwd, pid: s.proc.pid, closed: s.closed });
  }
  return { count: sessions.length, sessions };
}

// ── Control state ─────────────────────────────────────────────────────────────
const ctrl = {
  emergencyStopped: false,
  userPaused:       false,
};

const executionProfile = {
  mode: 'quiet',
  announceActions: false,
  preActionDelayMs: 700,
  notificationTitle: 'os-bridge',
};

function checkInputAllowed() {
  if (ctrl.emergencyStopped) throw new Error('EMERGENCY_STOP is active. Call reset_emergency_stop to re-enable input tools.');
  if (ctrl.userPaused)       throw new Error('User has paused AI input control. Call resume_control to re-enable.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateText(str, max = 70) {
  const s = String(str || '');
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function actionPreview(toolName, args = {}) {
  switch (toolName) {
    case 'move_mouse':
      return `About to move mouse to (${args.x}, ${args.y})`;
    case 'click_mouse':
      return `About to ${args.double ? 'double-' : ''}click ${args.button || 'left'} at (${args.x}, ${args.y})`;
    case 'drag_mouse':
      return `About to drag mouse from (${args.fromX}, ${args.fromY}) to (${args.toX}, ${args.toY})`;
    case 'scroll':
      return `About to scroll ${args.direction || 'down'} by ${args.amount || 3} notch(es)`;
    case 'type_text':
      return `About to type text: "${truncateText(args.text)}"`;
    case 'press_key':
      return `About to press key combo: ${args.key}`;
    case 'focus_window':
      return `About to focus window matching: "${truncateText(args.title)}"`;
    case 'close_window':
      return `About to close window matching: "${truncateText(args.title)}"`;
    case 'run_command':
      return `About to run command: ${truncateText(args.command, 120)}`;
    default:
      return `About to run ${toolName}`;
  }
}

async function maybeAnnounceAction(toolName, args) {
  if (executionProfile.mode !== 'visible' || !executionProfile.announceActions) return;

  const message = actionPreview(toolName, args);
  try {
    await sendNotification({
      title: executionProfile.notificationTitle,
      message,
    });
  } catch {
    // Notifications are best-effort; execution should not fail if toast fails.
  }

  if (executionProfile.preActionDelayMs > 0) {
    await sleep(executionProfile.preActionDelayMs);
  }
}

// ── PowerShell runner (temp-file approach for complex scripts) ────────────────
function psRun(script, timeoutMs = 15000) {
  const tmp = path.join(os.tmpdir(), `osb_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
  fs.writeFileSync(tmp, script, 'utf8');
  try {
    return execSync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmp}"`,
      { timeout: timeoutMs, encoding: 'utf8', windowsHide: true }
    ).trim();
  } catch (err) {
    // Include both message and any stderr
    const msg = (err.stderr || '').trim() || err.message;
    throw new Error(msg);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function tryJson(str) {
  try { return JSON.parse(str); } catch { return str; }
}

// ── SendKeys escaping (for literal text typing) ───────────────────────────────
function escapeSendKeys(text) {
  // Wrap SendKeys special chars in {} so they are typed literally
  return text.replace(/[+^%~(){}]/g, '{$&}');
}

// ── Shared PowerShell type definitions ───────────────────────────────────────
const PS_MOUSE = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MouseOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
    public const uint LEFTDOWN=2, LEFTUP=4, RIGHTDOWN=8, RIGHTUP=16, MIDDLEDOWN=32, MIDDLEUP=64, WHEEL=0x800;
}
'@ -ErrorAction SilentlyContinue`;

const PS_WINFOCUS = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int n);
}
'@ -ErrorAction SilentlyContinue`;

// ── Tool implementations ──────────────────────────────────────────────────────

async function getSystemInfo() {
  const script = `
$cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1
$osi  = Get-CimInstance Win32_OperatingSystem
$disks = Get-PSDrive -PSProvider FileSystem | Select-Object Name,
  @{N='usedGB';  E={if($_.Used  -ne $null){[math]::Round($_.Used  /1GB,2)}else{$null}}},
  @{N='freeGB';  E={if($_.Free  -ne $null){[math]::Round($_.Free  /1GB,2)}else{$null}}}

@{
  cpu = @{
    name               = $cpu.Name
    cores              = $cpu.NumberOfCores
    logicalProcessors  = $cpu.NumberOfLogicalProcessors
    loadPercent        = $cpu.LoadPercentage
  }
  memory = @{
    totalGB     = [math]::Round($osi.TotalVisibleMemorySize / 1MB, 2)
    freeGB      = [math]::Round($osi.FreePhysicalMemory     / 1MB, 2)
    usedPercent = [math]::Round((($osi.TotalVisibleMemorySize - $osi.FreePhysicalMemory) / $osi.TotalVisibleMemorySize) * 100, 1)
  }
  disks       = @($disks)
  hostname    = $env:COMPUTERNAME
  username    = $env:USERNAME
  os          = $osi.Caption
  osVersion   = $osi.Version
  uptimeHours = [math]::Round(((Get-Date) - $osi.LastBootUpTime).TotalHours, 1)
} | ConvertTo-Json -Depth 5`;
  return tryJson(psRun(script, 20000));
}

async function getProcesses(args) {
  const limit   = parseInt(args.limit)  || 50;
  const sortBy  = args.sortBy || 'memory';
  const filter  = args.filter ? args.filter.replace(/'/g, "''") : null;
  const sortCol = sortBy === 'cpu' ? 'CpuS' : sortBy === 'name' ? 'ProcessName' : 'MemMB';
  const filterLine = filter ? `$procs = $procs | Where-Object { $_.ProcessName -like '*${filter}*' -or $_.MainWindowTitle -like '*${filter}*' }` : '';
  const script = `
$procs = Get-Process | Select-Object Id, ProcessName,
  @{N='CpuS';  E={[math]::Round($_.CPU, 2)}},
  @{N='MemMB'; E={[math]::Round($_.WorkingSet64 / 1MB, 1)}},
  MainWindowTitle
${filterLine}
$procs = $procs | Sort-Object ${sortCol} -Descending
$procs | Select-Object -First ${limit} | ConvertTo-Json -Compress`;
  return tryJson(psRun(script));
}

async function killProcess(args) {
  if (!args.pid && !args.name) throw new Error('pid or name required');
  const script = args.pid
    ? `Stop-Process -Id ${parseInt(args.pid)} -Force -ErrorAction Stop; "killed PID ${parseInt(args.pid)}"`
    : `Stop-Process -Name '${args.name.replace(/'/g, "''")}' -Force -ErrorAction Stop; "killed ${args.name}"`;
  return psRun(script);
}

async function getOpenPorts() {
  const script = `
$conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
$result = $conns | ForEach-Object {
  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  [PSCustomObject]@{
    address = $_.LocalAddress
    port    = $_.LocalPort
    pid     = $_.OwningProcess
    process = $p.ProcessName
  }
} | Sort-Object port
$result | ConvertTo-Json -Compress`;
  return tryJson(psRun(script, 20000));
}

async function searchFiles(args) {
  if (!args.pattern) throw new Error('pattern required');
  const searchPath = (args.path || 'C:\\').replace(/'/g, "''");
  const pattern    = args.pattern.replace(/'/g, "''");
  const maxResults = parseInt(args.maxResults) || 50;
  const script = `
$results = Get-ChildItem -Path '${searchPath}' -Recurse -Filter '${pattern}' -File -ErrorAction SilentlyContinue |
  Select-Object -First ${maxResults} |
  Select-Object FullName, @{N='sizeKB'; E={[math]::Round($_.Length / 1KB, 1)}}, LastWriteTime
$results | ConvertTo-Json -Compress`;
  return tryJson(psRun(script, 45000));
}

async function getScreenSize() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$s = [System.Windows.Forms.Screen]::PrimaryScreen
@{
  width       = $s.Bounds.Width
  height      = $s.Bounds.Height
  workWidth   = $s.WorkingArea.Width
  workHeight  = $s.WorkingArea.Height
  allScreens  = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
    @{ width=$_.Bounds.Width; height=$_.Bounds.Height; primary=$_.Primary; name=$_.DeviceName }
  })
} | ConvertTo-Json -Depth 4`;
  return tryJson(psRun(script));
}

async function readClipboard() {
  const out = psRun(`Get-Clipboard`);
  return { text: out };
}

async function writeClipboard(args) {
  if (args.text == null) throw new Error('text required');
  const escaped = args.text.replace(/'/g, "''");
  psRun(`Set-Clipboard -Value '${escaped}'`);
  return 'Clipboard updated';
}

async function sendNotification(args) {
  if (!args.message) throw new Error('message required');
  const title   = (args.title   || 'OS Bridge').replace(/'/g, "''");
  const message = args.message.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon              = [System.Drawing.SystemIcons]::Information
$n.BalloonTipTitle   = '${title}'
$n.BalloonTipText    = '${message}'
$n.BalloonTipIcon    = [System.Windows.Forms.ToolTipIcon]::Info
$n.Visible           = $true
$n.ShowBalloonTip(4000)
Start-Sleep -Milliseconds 600
$n.Visible = $false
$n.Dispose()
"sent"`;
  psRun(script, 8000);
  return 'Notification sent';
}

async function getMousePosition() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$p = [System.Windows.Forms.Cursor]::Position
"$($p.X),$($p.Y)"`;
  const out = psRun(script);
  const [x, y] = out.split(',').map(Number);
  return { x, y };
}

async function moveMouse(args) {
  checkInputAllowed();
  if (args.x == null || args.y == null) throw new Error('x and y required');
  await maybeAnnounceAction('move_mouse', args);
  const x = parseInt(args.x), y = parseInt(args.y);
  const script = `${PS_MOUSE}\n[MouseOps]::SetCursorPos(${x}, ${y})\n"moved to ${x},${y}"`;
  return psRun(script);
}

async function clickMouse(args) {
  checkInputAllowed();
  if (args.x == null || args.y == null) throw new Error('x and y required');
  await maybeAnnounceAction('click_mouse', args);
  const x      = parseInt(args.x);
  const y      = parseInt(args.y);
  const button = args.button || 'left';
  const clicks = args.double ? 2 : 1;

  let clickOps = '';
  for (let i = 0; i < clicks; i++) {
    if (button === 'right') {
      clickOps += '[MouseOps]::mouse_event([MouseOps]::RIGHTDOWN, 0, 0, 0, [IntPtr]::Zero)\nStart-Sleep -Milliseconds 50\n[MouseOps]::mouse_event([MouseOps]::RIGHTUP, 0, 0, 0, [IntPtr]::Zero)\n';
    } else if (button === 'middle') {
      clickOps += '[MouseOps]::mouse_event([MouseOps]::MIDDLEDOWN, 0, 0, 0, [IntPtr]::Zero)\nStart-Sleep -Milliseconds 50\n[MouseOps]::mouse_event([MouseOps]::MIDDLEUP, 0, 0, 0, [IntPtr]::Zero)\n';
    } else {
      clickOps += '[MouseOps]::mouse_event([MouseOps]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)\nStart-Sleep -Milliseconds 50\n[MouseOps]::mouse_event([MouseOps]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)\n';
    }
    if (i < clicks - 1) clickOps += 'Start-Sleep -Milliseconds 80\n';
  }

  const script = `
${PS_MOUSE}
[MouseOps]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 100
${clickOps}
"${button}${clicks > 1 ? ' double' : ''} click at (${x},${y})"`;
  return psRun(script);
}

async function dragMouse(args) {
  checkInputAllowed();
  const { fromX, fromY, toX, toY } = args;
  if (fromX == null || fromY == null || toX == null || toY == null) throw new Error('fromX, fromY, toX, toY required');
  await maybeAnnounceAction('drag_mouse', args);
  const script = `
${PS_MOUSE}
[MouseOps]::SetCursorPos(${parseInt(fromX)}, ${parseInt(fromY)})
Start-Sleep -Milliseconds 80
[MouseOps]::mouse_event([MouseOps]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[MouseOps]::SetCursorPos(${parseInt(toX)}, ${parseInt(toY)})
Start-Sleep -Milliseconds 80
[MouseOps]::mouse_event([MouseOps]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
"dragged (${parseInt(fromX)},${parseInt(fromY)}) → (${parseInt(toX)},${parseInt(toY)})"`;
  return psRun(script);
}

async function scroll(args) {
  checkInputAllowed();
  await maybeAnnounceAction('scroll', args);
  const direction = args.direction || 'down';
  const amount    = parseInt(args.amount) || 3;
  const delta     = direction === 'up' ? 120 * amount : -(120 * amount);

  // Convert signed int to uint32 bits for PowerShell
  const script = `
${PS_MOUSE}
$signed = [int]${delta}
$uDelta = [System.BitConverter]::ToUInt32([System.BitConverter]::GetBytes($signed), 0)
[MouseOps]::mouse_event([MouseOps]::WHEEL, 0, 0, $uDelta, [IntPtr]::Zero)
"scrolled ${direction} ${amount} notch(es)"`;
  return psRun(script);
}

async function typeText(args) {
  checkInputAllowed();
  if (!args.text) throw new Error('text required');
  await maybeAnnounceAction('type_text', args);
  const escaped = escapeSendKeys(args.text).replace(/'/g, "''");
  const delay   = parseInt(args.delayMs) || 0;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
${delay > 0 ? `Start-Sleep -Milliseconds ${delay}` : ''}
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
"typed ${args.text.length} chars"`;
  return psRun(script);
}

async function pressKey(args) {
  checkInputAllowed();
  if (!args.key) throw new Error('key required. Examples: "^c" (Ctrl+C), "%{F4}" (Alt+F4), "{ENTER}", "+{TAB}" (Shift+Tab)');
  await maybeAnnounceAction('press_key', args);
  const escaped = args.key.replace(/'/g, "''");
  const delay   = parseInt(args.delayMs) || 0;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
${delay > 0 ? `Start-Sleep -Milliseconds ${delay}` : ''}
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
"sent key: ${args.key}"`;
  return psRun(script);
}

async function takeScreenshot(args) {
  const monitor = parseInt(args.monitor) || 0;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
$s = if (${monitor} -lt $screens.Length) { $screens[${monitor}] } else { [System.Windows.Forms.Screen]::PrimaryScreen }
$b = $s.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$ms  = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray())`;
  const b64 = psRun(script, 20000);
  return { mimeType: 'image/png', data: b64, _isImage: true };
}

async function listWindows() {
  const script = `
Get-Process |
  Where-Object { $_.MainWindowTitle -ne '' } |
  Select-Object @{N='pid';E={$_.Id}}, @{N='name';E={$_.ProcessName}}, @{N='title';E={$_.MainWindowTitle}} |
  ConvertTo-Json -Compress`;
  return tryJson(psRun(script));
}

async function focusWindow(args) {
  checkInputAllowed();
  if (!args.title) throw new Error('title required');
  await maybeAnnounceAction('focus_window', args);
  const title = args.title.replace(/'/g, "''");
  const script = `
${PS_WINFOCUS}
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1
if (-not $proc) { throw "No window found matching: ${title}" }
[WinFocus]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
Start-Sleep -Milliseconds 100
[WinFocus]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
"focused: $($proc.MainWindowTitle)"`;
  return psRun(script);
}

async function getActiveWindow() {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ActiveWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
'@ -ErrorAction SilentlyContinue
$hwnd = [ActiveWin]::GetForegroundWindow()
$sb   = New-Object System.Text.StringBuilder(512)
[ActiveWin]::GetWindowText($hwnd, $sb, 512) | Out-Null
$pid2 = [uint32]0
[ActiveWin]::GetWindowThreadProcessId($hwnd, [ref]$pid2) | Out-Null
$proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
@{ title=$sb.ToString(); pid=[int]$pid2; processName=$proc.ProcessName } | ConvertTo-Json`;
  return tryJson(psRun(script));
}

async function closeWindow(args) {
  checkInputAllowed();
  if (!args.title) throw new Error('title required');
  await maybeAnnounceAction('close_window', args);
  const title = args.title.replace(/'/g, "''");
  const script = `
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1
if (-not $proc) { throw "No window found matching: ${title}" }
$ok = $proc.CloseMainWindow()
"CloseMainWindow=$ok  window='$($proc.MainWindowTitle)'"`;
  return psRun(script);
}

function execCommand(cmd, timeoutMs) {
  return new Promise((resolve) => {
    execCb(cmd, { timeout: timeoutMs, encoding: 'utf8', shell: 'powershell', windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        stdout:   (stdout  || '').trim(),
        stderr:   (stderr  || '').trim(),
        exitCode: err ? (err.code || 1) : 0,
        timedOut: !!(err && err.killed),
      });
    });
  });
}

async function runCommand(args) {
  if (!args.command) throw new Error('command required');
  await maybeAnnounceAction('run_command', args);
  return execCommand(args.command, parseInt(args.timeoutMs) || 30000);
}

function readFile(args) {
  if (!args.filePath) throw new Error('filePath required');
  const filePath = path.resolve(String(args.filePath));
  const encoding = args.encoding === 'base64' ? 'base64' : 'utf8';
  const maxBytes = Number.isFinite(args.maxBytes) ? args.maxBytes : 524288;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);

  const bytesToRead = Math.min(stat.size, maxBytes);
  const buf = Buffer.alloc(bytesToRead);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, bytesToRead, 0);
  } finally {
    fs.closeSync(fd);
  }

  const content = buf.toString(encoding);
  return {
    filePath,
    sizeBytes: stat.size,
    readBytes: bytesToRead,
    truncated: stat.size > maxBytes,
    encoding,
    content
  };
}

function writeFile(args) {
  if (!args.filePath) throw new Error('filePath required');
  if (args.content == null) throw new Error('content required');

  const filePath = path.resolve(String(args.filePath));
  const encoding = args.encoding === 'base64' ? 'base64' : 'utf8';
  const append   = Boolean(args.append);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (append) {
    fs.appendFileSync(filePath, args.content, encoding);
  } else {
    fs.writeFileSync(filePath, args.content, encoding);
  }

  const stat = fs.statSync(filePath);
  return {
    filePath,
    written: true,
    append,
    sizeBytes: stat.size
  };
}


function getEnvironmentVars(args) {  const env = process.env;

  if (args.names && Array.isArray(args.names) && args.names.length > 0) {
    const result = {};
    for (const name of args.names) {
      result[name] = env[name] !== undefined ? env[name] : null;
    }
    return { filtered: true, filterType: 'names', count: Object.keys(result).length, vars: result };
  }

  const prefix = args.prefix ? String(args.prefix).toLowerCase() : null;
  const vars = {};
  for (const [k, v] of Object.entries(env)) {
    if (!prefix || k.toLowerCase().startsWith(prefix)) {
      vars[k] = v;
    }
  }

  return {
    filtered: Boolean(prefix),
    filterType: prefix ? 'prefix' : 'all',
    count: Object.keys(vars).length,
    vars
  };
}

function listDirectory(args) {
  if (!args.dirPath) throw new Error('dirPath required');
  const dirPath = path.resolve(String(args.dirPath));
  if (!fs.existsSync(dirPath)) throw new Error(`Directory not found: ${dirPath}`);
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${dirPath}`);

  const filter    = args.filter ? String(args.filter).toLowerCase() : null;
  const recursive = Boolean(args.recursive);
  const maxEntries = Number.isFinite(args.maxEntries) ? args.maxEntries : 500;

  const entries = [];

  function walk(dir, depth) {
    if (entries.length >= maxEntries) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }

    for (const name of names) {
      if (entries.length >= maxEntries) break;
      const fullPath = path.join(dir, name);
      let s;
      try { s = fs.statSync(fullPath); } catch { continue; }

      const ext = path.extname(name).toLowerCase();
      if (filter && ext !== filter && ('.' + name.toLowerCase()) !== filter) continue;

      entries.push({
        name,
        path: fullPath,
        type: s.isDirectory() ? 'directory' : 'file',
        sizeBytes: s.isDirectory() ? null : s.size,
        modifiedAt: s.mtime.toISOString(),
        depth,
      });

      if (recursive && s.isDirectory()) walk(fullPath, depth + 1);
    }
  }

  walk(dirPath, 0);

  return {
    dirPath,
    filter: filter || null,
    recursive,
    count: entries.length,
    truncated: false,  // maxEntries enforced above
    entries,
  };
}

function openUrl(args) {
  if (!args.url) throw new Error('url required');
  const url = String(args.url).trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('url must start with http:// or https://');

  // Shell-safe: pass via PowerShell Start-Process to avoid injection
  const escaped = url.replace(/'/g, "''");
  const ps = `Start-Process '${escaped}'`;
  const cp = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    timeout: 10000,
    windowsHide: true,
  });

  if (cp.error) throw new Error(`open_url failed: ${cp.error.message}`);

  return { opened: true, url };
}

async function getWindowRect(args) {
  if (!args.title) throw new Error('title required');
  const title = args.title.replace(/'/g, "''");
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinRect {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@ -ErrorAction SilentlyContinue
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1
if (-not $proc) { throw "No window found matching: ${title}" }
$rect = New-Object WinRect+RECT
[WinRect]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
@{ x = $rect.Left; y = $rect.Top; width = ($rect.Right - $rect.Left); height = ($rect.Bottom - $rect.Top); pid = [int]$proc.Id; processName = $proc.ProcessName; title = $proc.MainWindowTitle } | ConvertTo-Json -Compress`;
  return tryJson(psRun(script, 15000));
}

async function screenshotWindow(args) {
  if (!args.title) throw new Error('title required');
  const title = args.title.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinCapture {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
'@ -ErrorAction SilentlyContinue
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1
if (-not $proc) {
  $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap($s.Width, $s.Height)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output ("FALLBACK:" + [Convert]::ToBase64String($ms.ToArray()))
} else {
  [WinCapture]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
  [WinCapture]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 300
  $rect = New-Object WinCapture+RECT
  [WinCapture]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
  $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
  if ($w -le 0 -or $h -le 0) { throw "Window has zero size: $($proc.MainWindowTitle)" }
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($w, $h))
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output ([Convert]::ToBase64String($ms.ToArray()))
}`;
  const raw = psRun(script, 25000);
  let b64 = raw, warning;
  if (raw.startsWith('FALLBACK:')) {
    b64 = raw.slice('FALLBACK:'.length);
    warning = `No window matched '${args.title}' — captured full primary screen instead`;
  }
  const result = { mimeType: 'image/png', data: b64.trim(), _isImage: true };
  if (warning) result.warning = warning;
  return result;
}

function getExecutionProfile() {
  return {
    ...executionProfile,
    humanTakeoverHint: 'Use pause_control or emergency_stop to take over instantly.',
  };
}

function setExecutionProfile(args) {
  if (args.mode && !['quiet', 'visible'].includes(args.mode)) {
    throw new Error('mode must be "quiet" or "visible"');
  }

  if (args.mode) executionProfile.mode = args.mode;
  if (typeof args.announceActions === 'boolean') executionProfile.announceActions = args.announceActions;

  if (args.preActionDelayMs != null) {
    const parsed = parseInt(args.preActionDelayMs);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 5000) {
      throw new Error('preActionDelayMs must be between 0 and 5000');
    }
    executionProfile.preActionDelayMs = parsed;
  }

  if (args.notificationTitle != null) {
    const title = String(args.notificationTitle || '').trim();
    executionProfile.notificationTitle = title || 'os-bridge';
  }

  if (executionProfile.mode === 'quiet') {
    executionProfile.announceActions = false;
  }

  return {
    updated: true,
    profile: getExecutionProfile(),
  };
}

// ── Control state tools ───────────────────────────────────────────────────────
function getControlState() {
  return {
    emergencyStopped: ctrl.emergencyStopped,
    userPaused:       ctrl.userPaused,
    inputAllowed:     !ctrl.emergencyStopped && !ctrl.userPaused,
    executionProfile: getExecutionProfile(),
    hint: !ctrl.emergencyStopped && !ctrl.userPaused
      ? 'Input tools (mouse/keyboard/window) are ready to use.'
      : ctrl.emergencyStopped
        ? 'EMERGENCY_STOP active — call reset_emergency_stop to re-enable.'
        : 'User has paused control — call resume_control to re-enable.',
  };
}

function requestControl() {
  if (ctrl.emergencyStopped) return { granted: false, reason: 'EMERGENCY_STOP active. Call reset_emergency_stop first.' };
  if (ctrl.userPaused)       return { granted: false, reason: 'User has paused AI control. They must call resume_control.' };
  return { granted: true, message: 'AI input control granted. Call release_control when done.' };
}

function releaseControl() {
  return { released: true, message: 'AI input control released back to user.' };
}

function pauseControl() {
  ctrl.userPaused = true;
  return { paused: true, message: 'AI input tools paused by user. Call resume_control to re-enable.' };
}

function resumeControl() {
  if (ctrl.emergencyStopped) return { resumed: false, reason: 'Emergency stop still active. Call reset_emergency_stop first.' };
  ctrl.userPaused = false;
  return { resumed: true, message: 'AI input control resumed.' };
}

function emergencyStop() {
  ctrl.emergencyStopped = true;
  return { stopped: true, message: 'EMERGENCY STOP activated. All mouse/keyboard/window tools are now disabled. Call reset_emergency_stop to re-enable.' };
}

function resetEmergencyStop() {
  ctrl.emergencyStopped = false;
  return { reset: true, message: 'Emergency stop cleared. Input tools are re-enabled.' };
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  // ── System info ──────────────────────────────────────────────────────────
  {
    name: 'get_system_info',
    description: 'Get CPU name/load, RAM usage, disk space per drive, hostname, username, OS version, and uptime.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_processes',
    description: 'List running processes with PID, name, CPU seconds, and memory (MB). Sort by memory, cpu, or name.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number',  description: 'Max processes to return (default 50)' },
        sortBy: { type: 'string',  enum: ['memory','cpu','name'], description: 'Sort order (default: memory)' },
        filter: { type: 'string',  description: 'Optional name/title filter substring' },
      },
    },
  },
  {
    name: 'kill_process',
    description: 'Kill a process by PID or by name.',
    inputSchema: {
      type: 'object',
      properties: {
        pid:  { type: 'number', description: 'Process ID' },
        name: { type: 'string', description: 'Process name (e.g. "notepad")' },
      },
    },
  },
  {
    name: 'get_open_ports',
    description: 'List all TCP ports currently in LISTEN state with the owning process name.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_files',
    description: 'Find files by glob pattern under a path. Returns full path, size, and last-modified date.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern:    { type: 'string', description: 'Glob pattern, e.g. "*.log" or "config*.json"' },
        path:       { type: 'string', description: 'Root search path (default: C:\\)' },
        maxResults: { type: 'number', description: 'Max results (default 50)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'get_screen_size',
    description: 'Get the pixel dimensions of all connected monitors.',
    inputSchema: { type: 'object', properties: {} },
  },
  // ── Clipboard & notifications ─────────────────────────────────────────────
  {
    name: 'read_clipboard',
    description: 'Read the current Windows clipboard contents as text.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'write_clipboard',
    description: 'Set the Windows clipboard to the given text.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to put on clipboard' } },
      required: ['text'],
    },
  },
  {
    name: 'send_notification',
    description: 'Send a Windows system-tray balloon notification.',
    inputSchema: {
      type: 'object',
      properties: {
        title:   { type: 'string', description: 'Notification title (default: OS Bridge)' },
        message: { type: 'string', description: 'Body text' },
      },
      required: ['message'],
    },
  },
  {
    name: 'get_execution_profile',
    description: 'Get current execution profile. quiet = no pre-action announcements, visible = announce before risky actions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_execution_profile',
    description: 'Set execution profile for interactive tools. Use mode="visible" and announceActions=true to show upcoming actions before click/type/etc.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['quiet', 'visible'], description: 'quiet (default) or visible' },
        announceActions: { type: 'boolean', description: 'Whether to announce actions via notifications in visible mode' },
        preActionDelayMs: { type: 'number', description: 'Delay before action in visible mode (0..5000, default 700)' },
        notificationTitle: { type: 'string', description: 'Toast title for announcements' },
      },
    },
  },
  // ── Mouse ─────────────────────────────────────────────────────────────────
  {
    name: 'get_mouse_position',
    description: 'Get the current mouse cursor position as {x, y} in screen pixels.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'move_mouse',
    description: 'Move the mouse cursor to absolute screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X in pixels from left edge' },
        y: { type: 'number', description: 'Y in pixels from top edge' },
      },
      required: ['x','y'],
    },
  },
  {
    name: 'click_mouse',
    description: 'Click (or double-click) at a screen coordinate. Moves cursor first.',
    inputSchema: {
      type: 'object',
      properties: {
        x:      { type: 'number', description: 'X coordinate' },
        y:      { type: 'number', description: 'Y coordinate' },
        button: { type: 'string', enum: ['left','right','middle'], description: 'Mouse button (default: left)' },
        double: { type: 'boolean', description: 'Double-click (default: false)' },
      },
      required: ['x','y'],
    },
  },
  {
    name: 'drag_mouse',
    description: 'Click-and-drag from one screen coordinate to another (left mouse button).',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number' }, fromY: { type: 'number' },
        toX:   { type: 'number' }, toY:   { type: 'number' },
      },
      required: ['fromX','fromY','toX','toY'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the mouse wheel at the current cursor position.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up','down'], description: 'Scroll direction (default: down)' },
        amount:    { type: 'number', description: 'Notches to scroll (default: 3)' },
      },
    },
  },
  // ── Keyboard ──────────────────────────────────────────────────────────────
  {
    name: 'type_text',
    description: 'Type literal text into the focused window. Special characters are auto-escaped. Use focus_window first if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        text:    { type: 'string', description: 'Text to type' },
        delayMs: { type: 'number', description: 'Delay before typing starts (ms, default: 0)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'press_key',
    description: 'Send a key combination using SendKeys syntax. Examples: "^c" (Ctrl+C), "^v" (Ctrl+V), "%{F4}" (Alt+F4), "{ENTER}", "{TAB}", "+{TAB}" (Shift+Tab), "^z" (Undo), "^a" (Select All), "{ESC}", "{F5}".',
    inputSchema: {
      type: 'object',
      properties: {
        key:     { type: 'string', description: 'SendKeys key combo string' },
        delayMs: { type: 'number', description: 'Delay before sending (ms, default: 0)' },
      },
      required: ['key'],
    },
  },
  // ── Screen ────────────────────────────────────────────────────────────────
  {
    name: 'take_screenshot',
    description: 'Capture the screen (or a specific monitor) as a PNG image.',
    inputSchema: {
      type: 'object',
      properties: {
        monitor: { type: 'number', description: 'Monitor index (0 = primary, default 0)' },
      },
    },
  },
  // ── Windows ───────────────────────────────────────────────────────────────
  {
    name: 'list_windows',
    description: 'List all visible windows with their titles, PIDs, and process names.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'focus_window',
    description: 'Bring a window to the foreground by matching its title (partial, case-insensitive).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Partial window title to match' },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_active_window',
    description: 'Get the title, PID, and process name of the currently focused window.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'close_window',
    description: 'Send a graceful close (WM_CLOSE) to a window matched by title. The app may prompt to save.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Partial window title to match' },
      },
      required: ['title'],
    },
  },
  // ── Shell ─────────────────────────────────────────────────────────────────
  {
    name: 'run_command',
    description: 'Execute a PowerShell command or script string. Returns stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command:   { type: 'string', description: 'PowerShell command to run' },
        timeoutMs: { type: 'number', description: 'Timeout ms (default 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a local file. Returns text content and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath:  { type: 'string', description: 'Absolute path to the file' },
        encoding:  { type: 'string', description: 'File encoding (default: utf8)', enum: ['utf8', 'base64'] },
        maxBytes:  { type: 'number', description: 'Max bytes to read (default 524288 = 512KB)', minimum: 1, maximum: 10485760 }
      },
      required: ['filePath'],
    },
  },
  {
    name: 'write_file',
    description: 'Write text content to a local file. Creates parent directories if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath:  { type: 'string', description: 'Absolute path to the file to write' },
        content:   { type: 'string', description: 'Content to write' },
        encoding:  { type: 'string', description: 'File encoding (default: utf8)', enum: ['utf8', 'base64'] },
        append:    { type: 'boolean', description: 'If true, append to existing file instead of overwriting' }
      },
      required: ['filePath', 'content'],
    },
  },
  {
    name: 'get_environment_vars',
    description: 'List environment variables visible to the os-bridge process. Optionally filter by prefix.',
    inputSchema: {
      type: 'object',
      properties: {
        prefix:    { type: 'string', description: 'Only return variables whose name starts with this prefix (case-insensitive)' },
        names:     { type: 'array', items: { type: 'string' }, description: 'Exact variable names to return. If provided, prefix is ignored.' }
      },
    },
  },
  {
    name: 'open_url',
    description: 'Open a URL in the default Windows browser using Start-Process.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open (must begin with http:// or https://)' }
      },
      required: ['url'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and sub-directories at a given path. Returns names, types, sizes, and mod times.',
    inputSchema: {
      type: 'object',
      properties: {
        dirPath:    { type: 'string', description: 'Absolute path to the directory' },
        filter:     { type: 'string', description: 'Optional glob-style extension filter, e.g. ".js" or ".json"' },
        recursive:  { type: 'boolean', description: 'If true, walk sub-directories (default false)' },
        maxEntries: { type: 'number', description: 'Max entries to return (default 500)', minimum: 1, maximum: 5000 }
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'get_window_rect',
    description: 'Get the screen coordinates and dimensions of a window by title. Returns {x, y, width, height, pid, processName, title}.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Window title pattern (partial match, case-insensitive)' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'screenshot_window',
    description: 'Capture a screenshot of a specific window by title. Focuses and crops to the window bounds. Falls back to full screen if the window is not found.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Window title pattern (partial match, case-insensitive)' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  // ── Persistent shell sessions ──────────────────────────────────────────────
  {
    name: 'shell_open',
    description: 'Open a persistent interactive shell session (PowerShell or cmd). Returns a sessionId for subsequent shell_send / shell_read / shell_close calls.',
    inputSchema: {
      type: 'object',
      properties: {
        shell: { type: 'string', enum: ['powershell', 'cmd'], description: 'Shell type (default: powershell)' },
        cwd:   { type: 'string', description: 'Working directory for the session (default: server cwd)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'shell_send',
    description: 'Send a command to an open shell session and wait for output to settle. Returns stdout + stderr captured since last send.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID from shell_open' },
        command:   { type: 'string', description: 'Command line to send' },
        timeoutMs: { type: 'number', description: 'Max ms to wait for output to settle (default 5000)', minimum: 200, maximum: 60000 },
      },
      required: ['sessionId', 'command'],
      additionalProperties: false,
    },
  },
  {
    name: 'shell_read',
    description: 'Read buffered stdout/stderr from an open session without sending a command.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID from shell_open' },
        clear:     { type: 'boolean', description: 'If true, clear the buffer after reading (default false)' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'shell_close',
    description: 'Close and destroy a persistent shell session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID from shell_open' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'shell_list_sessions',
    description: 'List all currently open persistent shell sessions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  // ── Control state ─────────────────────────────────────────────────────────
  {
    name: 'get_control_state',
    description: 'Check the current AI input control state: whether emergency stop or user pause is active.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'request_control',
    description: 'AI announces it is about to use input tools. Returns whether control is granted. Advisory — input tools work regardless, but calling this is good practice.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'release_control',
    description: 'AI announces it has finished using input tools.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'pause_control',
    description: 'USER calls this to pause AI input tools (mouse/keyboard). AI input is blocked until resume_control.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'resume_control',
    description: 'Resume AI input tools after a user pause.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'emergency_stop',
    description: 'HARD STOP — immediately disables all AI mouse/keyboard/window tools. Requires reset_emergency_stop to re-enable. Use when you need to take over urgently.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'reset_emergency_stop',
    description: 'Clear the emergency stop flag and re-enable AI input tools.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Tool dispatcher ───────────────────────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {
    case 'get_system_info':     return getSystemInfo();
    case 'get_processes':       return getProcesses(args);
    case 'kill_process':        return killProcess(args);
    case 'get_open_ports':      return getOpenPorts();
    case 'search_files':        return searchFiles(args);
    case 'get_screen_size':     return getScreenSize();
    case 'read_clipboard':      return readClipboard();
    case 'write_clipboard':     return writeClipboard(args);
    case 'send_notification':   return sendNotification(args);
    case 'get_execution_profile': return getExecutionProfile();
    case 'set_execution_profile': return setExecutionProfile(args);
    case 'get_mouse_position':  return getMousePosition();
    case 'move_mouse':          return moveMouse(args);
    case 'click_mouse':         return clickMouse(args);
    case 'drag_mouse':          return dragMouse(args);
    case 'scroll':              return scroll(args);
    case 'type_text':           return typeText(args);
    case 'press_key':           return pressKey(args);
    case 'take_screenshot':     return takeScreenshot(args);
    case 'list_windows':        return listWindows();
    case 'focus_window':        return focusWindow(args);
    case 'get_active_window':   return getActiveWindow();
    case 'close_window':        return closeWindow(args);
    case 'run_command':         return runCommand(args);
    case 'read_file':           return readFile(args);
    case 'write_file':          return writeFile(args);
    case 'get_environment_vars': return getEnvironmentVars(args);
    case 'open_url':            return openUrl(args);
    case 'list_directory':      return listDirectory(args);
    case 'get_window_rect':       return getWindowRect(args);
    case 'screenshot_window':     return screenshotWindow(args);
    case 'shell_open':            return shellOpen(args);
    case 'shell_send':            return shellSend(args);
    case 'shell_read':            return shellRead(args);
    case 'shell_close':           return shellClose(args);
    case 'shell_list_sessions':   return shellListSessions();
    case 'get_control_state':   return getControlState();
    case 'request_control':     return requestControl();
    case 'release_control':     return releaseControl();
    case 'pause_control':       return pauseControl();
    case 'resume_control':      return resumeControl();
    case 'emergency_stop':      return emergencyStop();
    case 'reset_emergency_stop':return resetEmergencyStop();
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP stdio protocol ────────────────────────────────────────────────────────
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function makeResult(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }], isError: false };
}

function makeErrorResult(msg) {
  return { content: [{ type: 'text', text: String(msg) }], isError: true };
}

function makeImageResult(data) {
  return { content: [{ type: 'image', data: data.data, mimeType: data.mimeType }], isError: false };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (rawLine) => {
  const line = rawLine.trim();
  if (!line) return;

  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params } = msg;

  // Notifications (no id) — no response required
  if (id === undefined || id === null) return;

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'os-bridge', version: '1.0.0' },
        };
        break;

      case 'tools/list':
        result = { tools: TOOLS };
        break;

      case 'tools/call': {
        const toolName = params && params.name;
        const toolArgs = (params && params.arguments) || {};
        try {
          const data = await handleTool(toolName, toolArgs);
          // Screenshot returns image content
          if (data && data._isImage) {
            result = makeImageResult(data);
          } else {
            result = makeResult(data);
          }
        } catch (err) {
          result = makeErrorResult(`Error in ${toolName}: ${err.message}`);
        }
        break;
      }

      case 'ping':
        result = {};
        break;

      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
        return;
    }

    send({ jsonrpc: '2.0', id, result });
  } catch (err) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
  }
});

rl.on('close', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
