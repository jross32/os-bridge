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

let SERVER_VERSION = '0.0.0';
try {
  SERVER_VERSION = require('./package.json').version || SERVER_VERSION;
} catch {
  // Keep default when package metadata is unavailable.
}

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

class ToolContractError extends Error {
  constructor({ code, category, message, retryable = false, suggestedAction = '', details = null }) {
    super(message || 'Tool error');
    this.name = 'ToolContractError';
    this.code = code || 'tool_error';
    this.category = category || 'internal';
    this.retryable = Boolean(retryable);
    this.suggestedAction = suggestedAction || '';
    this.details = details;
  }
}

function validateSchemaValue(schema, value, pathName, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type) {
    switch (schema.type) {
      case 'object': {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          errors.push(`${pathName} must be an object`);
          return;
        }

        const props = schema.properties || {};
        const required = Array.isArray(schema.required) ? schema.required : [];
        for (const reqKey of required) {
          if (!Object.prototype.hasOwnProperty.call(value, reqKey)) {
            errors.push(`${pathName}.${reqKey} is required`);
          }
        }

        if (schema.additionalProperties === false) {
          for (const key of Object.keys(value)) {
            if (!Object.prototype.hasOwnProperty.call(props, key)) {
              errors.push(`${pathName}.${key} is not allowed`);
            }
          }
        }

        for (const [key, propSchema] of Object.entries(props)) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            validateSchemaValue(propSchema, value[key], `${pathName}.${key}`, errors);
          }
        }
        break;
      }
      case 'array': {
        if (!Array.isArray(value)) {
          errors.push(`${pathName} must be an array`);
          return;
        }
        if (schema.items) {
          value.forEach((item, idx) => validateSchemaValue(schema.items, item, `${pathName}[${idx}]`, errors));
        }
        break;
      }
      case 'string': {
        if (typeof value !== 'string') {
          errors.push(`${pathName} must be a string`);
          return;
        }
        if (schema.minLength != null && value.length < schema.minLength) {
          errors.push(`${pathName} must have min length ${schema.minLength}`);
        }
        if (schema.maxLength != null && value.length > schema.maxLength) {
          errors.push(`${pathName} must have max length ${schema.maxLength}`);
        }
        break;
      }
      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`${pathName} must be a number`);
          return;
        }
        if (schema.minimum != null && value < schema.minimum) {
          errors.push(`${pathName} must be >= ${schema.minimum}`);
        }
        if (schema.maximum != null && value > schema.maximum) {
          errors.push(`${pathName} must be <= ${schema.maximum}`);
        }
        break;
      }
      case 'integer': {
        if (!Number.isInteger(value)) {
          errors.push(`${pathName} must be an integer`);
          return;
        }
        if (schema.minimum != null && value < schema.minimum) {
          errors.push(`${pathName} must be >= ${schema.minimum}`);
        }
        if (schema.maximum != null && value > schema.maximum) {
          errors.push(`${pathName} must be <= ${schema.maximum}`);
        }
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') {
          errors.push(`${pathName} must be a boolean`);
        }
        break;
      }
      default:
        break;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${pathName} must be one of: ${schema.enum.join(', ')}`);
  }
}

function getToolDefinitionByName(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

function validateToolCallParams(toolName, toolArgs) {
  if (!toolName || typeof toolName !== 'string') {
    throw new ToolContractError({
      code: 'invalid_arguments',
      category: 'validation',
      message: 'tools/call requires a valid tool name string',
      retryable: false,
      suggestedAction: 'Pass a valid tool name from tools/list.',
    });
  }

  const toolDef = getToolDefinitionByName(toolName);
  if (!toolDef) {
    throw new ToolContractError({
      code: 'tool_not_found',
      category: 'not_found',
      message: `Unknown tool: ${toolName}`,
      retryable: false,
      suggestedAction: 'Call tools/list and choose a supported tool name.',
    });
  }

  const args = (toolArgs == null) ? {} : toolArgs;
  const schema = toolDef.inputSchema || { type: 'object', properties: {} };
  const errors = [];
  validateSchemaValue(schema, args, 'arguments', errors);

  if (errors.length > 0) {
    throw new ToolContractError({
      code: 'invalid_arguments',
      category: 'validation',
      message: `Invalid arguments for ${toolName}`,
      retryable: false,
      suggestedAction: 'Check tools/list inputSchema and resend valid arguments.',
      details: { toolName, errors },
    });
  }

  return { toolDef, args };
}

function normalizeToolError(err, toolName) {
  if (err instanceof ToolContractError) return err;

  const msg = String((err && err.message) || err || 'Unknown tool error');
  const lower = msg.toLowerCase();

  if (lower.includes('timed out') || lower.includes('timeout')) {
    return new ToolContractError({
      code: 'tool_timeout',
      category: 'timeout',
      message: msg,
      retryable: true,
      suggestedAction: 'Retry with a larger timeout or narrower operation scope.',
    });
  }

  if (lower.includes('not found') || lower.includes('no window found') || lower.includes('no session')) {
    return new ToolContractError({
      code: 'not_found',
      category: 'not_found',
      message: msg,
      retryable: false,
      suggestedAction: 'Refresh state and provide an existing resource selector.',
    });
  }

  if (lower.includes('required') || lower.includes('must be') || lower.includes('one of')) {
    return new ToolContractError({
      code: 'invalid_arguments',
      category: 'validation',
      message: msg,
      retryable: false,
      suggestedAction: 'Check tool inputSchema and correct argument values.',
    });
  }

  if (lower.includes('denied') || lower.includes('permission') || lower.includes('not permitted')) {
    return new ToolContractError({
      code: 'permission_denied',
      category: 'permission',
      message: msg,
      retryable: false,
      suggestedAction: 'Adjust permissions or run with required privileges.',
    });
  }

  return new ToolContractError({
    code: 'tool_error',
    category: 'internal',
    message: msg,
    retryable: false,
    suggestedAction: 'Review the tool error details and retry if conditions changed.',
  });
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
  return tryJson(psRun(script, 30000));
}

async function processResourceHotspots(args) {
  const topN = Math.max(1, Math.min(100, parseInt(args.topN) || 10));
  const script = `
$procs = Get-Process | Select-Object Id, ProcessName,
  @{N='CpuS'; E={if($_.CPU -ne $null){[math]::Round($_.CPU, 2)}else{0}}},
  @{N='MemMB'; E={[math]::Round($_.WorkingSet64 / 1MB, 1)}}

$topCpu = $procs | Sort-Object CpuS -Descending | Select-Object -First ${topN}
$topMem = $procs | Sort-Object MemMB -Descending | Select-Object -First ${topN}

@{
  topCpu    = @($topCpu)
  topMemory = @($topMem)
  sampledAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 6 -Compress`;
  return tryJson(psRun(script, 20000));
}

async function waitForProcessState(args) {
  if (!args.pid && !args.name) throw new Error('pid or name required');

  const desiredState = (args.desiredState || 'running').toLowerCase();
  if (desiredState !== 'running' && desiredState !== 'stopped') {
    throw new Error('desiredState must be running or stopped');
  }

  const timeoutMs = Math.max(500, Math.min(120000, parseInt(args.timeoutMs) || 10000));
  const pollMs = Math.max(50, Math.min(5000, parseInt(args.pollMs) || 250));
  const start = Date.now();

  const escapedName = args.name ? String(args.name).replace(/'/g, "''") : null;
  const pid = args.pid ? parseInt(args.pid) : null;

  while ((Date.now() - start) < timeoutMs) {
    const existsScript = pid
      ? `@((Get-Process -Id ${pid} -ErrorAction SilentlyContinue)).Count | ConvertTo-Json -Compress`
      : `@((Get-Process -Name '${escapedName}' -ErrorAction SilentlyContinue)).Count | ConvertTo-Json -Compress`;

    const count = Number(tryJson(psRun(existsScript, 10000))) || 0;
    const isRunning = count > 0;
    const matched = desiredState === 'running' ? isRunning : !isRunning;

    if (matched) {
      return {
        matched: true,
        desiredState,
        observedState: isRunning ? 'running' : 'stopped',
        elapsedMs: Date.now() - start,
        criteria: pid ? { pid } : { name: args.name },
      };
    }

    await sleep(pollMs);
  }

  return {
    matched: false,
    desiredState,
    timedOut: true,
    elapsedMs: Date.now() - start,
    criteria: pid ? { pid } : { name: args.name },
  };
}

async function processTree(args) {
  if (!args.pid && !args.processName) throw new Error('pid or processName required');

  const maxNodes = Math.max(1, Math.min(500, parseInt(args.maxNodes) || 200));
  const script = `
$procs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
$procs | ConvertTo-Json -Depth 6 -Compress`;

  const raw = tryJson(psRun(script, 25000));
  const rows = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  const nodesByPid = new Map();
  for (const row of rows) {
    const pid = Number(row.ProcessId);
    if (!Number.isFinite(pid)) continue;
    nodesByPid.set(pid, {
      pid,
      parentPid: Number(row.ParentProcessId) || 0,
      processName: row.Name || '',
      commandLine: row.CommandLine || '',
    });
  }

  let root = null;
  if (args.pid) {
    root = nodesByPid.get(parseInt(args.pid)) || null;
  } else {
    const needle = String(args.processName).toLowerCase();
    for (const node of nodesByPid.values()) {
      if ((node.processName || '').toLowerCase().includes(needle)) {
        root = node;
        break;
      }
    }
  }

  if (!root) {
    return {
      rootPid: null,
      rootName: null,
      totalNodes: 0,
      nodes: [],
      edges: [],
      warning: 'No matching root process found',
    };
  }

  const childrenMap = new Map();
  for (const node of nodesByPid.values()) {
    const parent = node.parentPid;
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent).push(node.pid);
  }

  const queue = [root.pid];
  const visited = new Set();
  const nodes = [];
  const edges = [];

  while (queue.length && nodes.length < maxNodes) {
    const pid = queue.shift();
    if (visited.has(pid)) continue;
    visited.add(pid);

    const node = nodesByPid.get(pid);
    if (!node) continue;
    nodes.push(node);

    const children = childrenMap.get(pid) || [];
    for (const childPid of children) {
      edges.push({ from: pid, to: childPid });
      if (!visited.has(childPid)) queue.push(childPid);
      if (nodes.length + queue.length >= maxNodes) break;
    }
  }

  return {
    rootPid: root.pid,
    rootName: root.processName,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    maxNodes,
    nodes,
    edges,
  };
}

async function processNetworkMap(args) {
  const limit = Math.max(1, Math.min(1000, parseInt(args.limit) || 200));
  const script = `
$conns = Get-NetTCPConnection -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess |
  Select-Object -First ${limit}

$procMap = @{}
Get-Process | ForEach-Object { $procMap[[int]$_.Id] = $_.ProcessName }

$summary = $conns | Group-Object OwningProcess | ForEach-Object {
  $pid = [int]$_.Name
  $rows = $_.Group
  [PSCustomObject]@{
    pid         = $pid
    processName = $procMap[$pid]
    connections = $rows.Count
    listening   = @($rows | Where-Object { $_.State -eq 'Listen' }).Count
    established = @($rows | Where-Object { $_.State -eq 'Established' }).Count
  }
} | Sort-Object connections -Descending

@{
  summary     = @($summary)
  connections = @($conns)
} | ConvertTo-Json -Depth 8 -Compress`;

  const out = tryJson(psRun(script, 25000));
  return {
    summary: Array.isArray(out.summary) ? out.summary : (out.summary ? [out.summary] : []),
    connections: Array.isArray(out.connections) ? out.connections : (out.connections ? [out.connections] : []),
    limit,
  };
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

function normalizeWindowSelectorArgs(args) {
  const hasPid = args && args.pid != null;
  const hasHwnd = args && args.hwnd != null && String(args.hwnd).trim() !== '';
  const hasTitle = args && args.title != null && String(args.title).trim() !== '';

  if (!hasPid && !hasHwnd && !hasTitle) {
    throw new Error('one of pid, hwnd, or title is required');
  }

  let pid = null;
  if (hasPid) {
    pid = parseInt(args.pid, 10);
    if (!Number.isFinite(pid) || pid <= 0) throw new Error('pid must be a positive integer');
  }

  const hwnd = hasHwnd ? String(args.hwnd).trim() : '';
  const title = hasTitle ? String(args.title).trim() : '';

  return { pid, hwnd, title };
}

function buildWindowResolvePs(selector) {
  const escTitle = selector.title ? selector.title.replace(/'/g, "''") : '';
  const escHwnd = selector.hwnd ? selector.hwnd.replace(/'/g, "''") : '';
  const pidBool = selector.pid != null ? '$true' : '$false';
  const pidLit = selector.pid != null ? String(selector.pid) : '0';

  return `
$proc = $null
$matchedBy = $null
if (${pidBool}) {
  $proc = Get-Process -Id ${pidLit} -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Select-Object -First 1
  if ($proc) { $matchedBy = 'pid' }
}
if (-not $proc -and '${escHwnd}' -ne '') {
  try {
    $targetHwnd = [IntPtr]([Int64]'${escHwnd}')
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $targetHwnd } | Select-Object -First 1
    if ($proc) { $matchedBy = 'hwnd' }
  } catch {}
}
if (-not $proc -and '${escTitle}' -ne '') {
  $proc = Get-Process | Where-Object {
    $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -like '*${escTitle}*'
  } | Select-Object -First 1
  if ($proc) { $matchedBy = 'title' }
}
if (-not $proc) {
  throw "No window found for pid=${selector.pid != null ? selector.pid : 'null'}, hwnd=${escHwnd || '<none>'}, title=${escTitle || '<none>'}"
}`;
}

async function focusWindow(args) {
  checkInputAllowed();
  const selector = normalizeWindowSelectorArgs(args);
  await maybeAnnounceAction('focus_window', args);
  const script = `
${PS_WINFOCUS}
${buildWindowResolvePs(selector)}
[WinFocus]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
Start-Sleep -Milliseconds 100
[WinFocus]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
"focused[$matchedBy]: $($proc.MainWindowTitle)"`;
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
  const selector = normalizeWindowSelectorArgs(args);
  await maybeAnnounceAction('close_window', args);
  const script = `
${buildWindowResolvePs(selector)}
$ok = $proc.CloseMainWindow()
"CloseMainWindow=$ok matchedBy=$matchedBy window='$($proc.MainWindowTitle)'"`;
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
  if (args.pid == null && !args.hwnd && !args.title) {
    throw new Error('one of pid, hwnd, or title is required');
  }
  const title = args.title ? String(args.title).replace(/'/g, "''") : '';
  const pid = Number.isFinite(args.pid) ? Number(args.pid) : null;
  const hwnd = args.hwnd ? String(args.hwnd).replace(/'/g, "''") : '';
  const titleCond = title ? `$proc = Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1` : '';
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
$proc = $null
$matchedBy = $null
if (${pid === null ? '$false' : '$true'}) {
  $proc = Get-Process -Id ${pid === null ? 0 : pid} -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Select-Object -First 1
  if ($proc) { $matchedBy = 'pid' }
}
if (-not $proc -and '${hwnd}' -ne '') {
  try {
    $targetHwnd = [IntPtr]([Int64]'${hwnd}')
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $targetHwnd } | Select-Object -First 1
    if ($proc) { $matchedBy = 'hwnd' }
  } catch {}
}
if (-not $proc) {
  ${titleCond}
  if ($proc) { $matchedBy = 'title' }
}
if (-not $proc) {
  throw "No window found for pid=${pid === null ? 'null' : pid}, hwnd=${hwnd || '<none>'}, title=${title || '<none>'}"
}
$rect = New-Object WinRect+RECT
[WinRect]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
@{ x = $rect.Left; y = $rect.Top; width = ($rect.Right - $rect.Left); height = ($rect.Bottom - $rect.Top); pid = [int]$proc.Id; processName = $proc.ProcessName; title = $proc.MainWindowTitle; matchedBy = $matchedBy } | ConvertTo-Json -Compress`;
  return tryJson(psRun(script, 15000));
}

async function screenshotWindow(args) {
  if (args.pid == null && !args.hwnd && !args.title) {
    throw new Error('one of pid, hwnd, or title is required');
  }
  const title = args.title ? String(args.title).replace(/'/g, "''") : '';
  const pid = Number.isFinite(args.pid) ? Number(args.pid) : null;
  const hwnd = args.hwnd ? String(args.hwnd).replace(/'/g, "''") : '';
  const titleCond = title ? `$proc = Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1` : '';
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
$proc = $null
$matchedBy = $null
if (${pid === null ? '$false' : '$true'}) {
  $proc = Get-Process -Id ${pid === null ? 0 : pid} -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Select-Object -First 1
  if ($proc) { $matchedBy = 'pid' }
}
if (-not $proc -and '${hwnd}' -ne '') {
  try {
    $targetHwnd = [IntPtr]([Int64]'${hwnd}')
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $targetHwnd } | Select-Object -First 1
    if ($proc) { $matchedBy = 'hwnd' }
  } catch {}
}
if (-not $proc) {
  ${titleCond}
  if ($proc) { $matchedBy = 'title' }
}
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
    const selector = args.pid != null ? `pid=${args.pid}` : (args.hwnd ? `hwnd=${args.hwnd}` : `title='${args.title}'`);
    warning = `No window matched ${selector} — captured full primary screen instead`;
  }
  const result = { mimeType: 'image/png', data: b64.trim(), _isImage: true };
  if (warning) result.warning = warning;
  return result;
}

// ── Wave 2: Window Intelligence ───────────────────────────────────────────────

async function listWindowsDetailed() {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinDetail {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
}
'@ -ErrorAction SilentlyContinue

$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -ne '' }
$result = @()
foreach ($p in $procs) {
    $rect = New-Object WinDetail+RECT
    [WinDetail]::GetWindowRect($p.MainWindowHandle, [ref]$rect) | Out-Null
    $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
    $state = if ([WinDetail]::IsIconic($p.MainWindowHandle)) { 'minimized' }
             elseif ([WinDetail]::IsZoomed($p.MainWindowHandle)) { 'maximized' }
             else { 'normal' }
    $result += @{
        pid         = [int]$p.Id
        processName = $p.ProcessName
        title       = $p.MainWindowTitle
        x           = $rect.Left
        y           = $rect.Top
        width       = $w
        height      = $h
        state       = $state
        visible     = [bool][WinDetail]::IsWindowVisible($p.MainWindowHandle)
        hwnd        = [string]$p.MainWindowHandle
    }
}
$result | ConvertTo-Json -Depth 3 -Compress`;
  return tryJson(psRun(script, 20000));
}

async function moveResizeWindow(args) {
  checkInputAllowed();
  const selector = normalizeWindowSelectorArgs(args);
  await maybeAnnounceAction('move_resize_window', args);
  const xArg    = Number.isFinite(args.x)      ? args.x      : null;
  const yArg    = Number.isFinite(args.y)       ? args.y      : null;
  const wArg    = Number.isFinite(args.width)   ? args.width  : null;
  const hArg    = Number.isFinite(args.height)  ? args.height : null;
  // Build PowerShell once with stable selector resolution.
  const nx = xArg !== null ? String(xArg) : '$rect.Left';
  const ny = yArg !== null ? String(yArg) : '$rect.Top';
  const nw = wArg !== null ? String(wArg) : '($rect.Right - $rect.Left)';
  const nh = hArg !== null ? String(hArg) : '($rect.Bottom - $rect.Top)';
  const ps = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinMove2 {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h, bool repaint);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
'@ -ErrorAction SilentlyContinue
${buildWindowResolvePs(selector)}
[WinMove2]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
Start-Sleep -Milliseconds 80
$rect = New-Object WinMove2+RECT
[WinMove2]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
$nx = ${nx}; $ny = ${ny}; $nw = ${nw}; $nh = ${nh}
[WinMove2]::MoveWindow($proc.MainWindowHandle, $nx, $ny, $nw, $nh, $true) | Out-Null
"moved[$matchedBy]: $($proc.MainWindowTitle) to x=$nx y=$ny w=$nw h=$nh"`;
  return psRun(ps, 10000);
}

async function minimizeMaximizeWindow(args) {
  checkInputAllowed();
  const selector = normalizeWindowSelectorArgs(args);
  const action = (args.action || 'minimize').toLowerCase();
  if (!['minimize', 'maximize', 'restore'].includes(action)) throw new Error('action must be minimize, maximize, or restore');
  await maybeAnnounceAction('minimize_maximize_window', args);
  // SW_MINIMIZE=6, SW_MAXIMIZE=3, SW_RESTORE=9
  const cmdMap = { minimize: 6, maximize: 3, restore: 9 };
  const swCmd = cmdMap[action];
  const ps = `
${PS_WINFOCUS}
${buildWindowResolvePs(selector)}
[WinFocus]::ShowWindow($proc.MainWindowHandle, ${swCmd}) | Out-Null
"${action}[$matchedBy]: $($proc.MainWindowTitle)"`;
  return psRun(ps, 8000);
}

async function getFocusedAppState() {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FocusedApp {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
}
'@ -ErrorAction SilentlyContinue
$hwnd = [FocusedApp]::GetForegroundWindow()
$sb   = New-Object System.Text.StringBuilder(1024)
[FocusedApp]::GetWindowText($hwnd, $sb, 1024) | Out-Null
$pid2 = [uint32]0
[FocusedApp]::GetWindowThreadProcessId($hwnd, [ref]$pid2) | Out-Null
$proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
$rect = New-Object FocusedApp+RECT
[FocusedApp]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$state = if ([FocusedApp]::IsIconic($hwnd)) { 'minimized' }
         elseif ([FocusedApp]::IsZoomed($hwnd)) { 'maximized' }
         else { 'normal' }
@{
    title       = $sb.ToString()
    pid         = [int]$pid2
    processName = if ($proc) { $proc.ProcessName } else { $null }
    executablePath = if ($proc) { $proc.Path } else { $null }
    x           = $rect.Left
    y           = $rect.Top
    width       = ($rect.Right - $rect.Left)
    height      = ($rect.Bottom - $rect.Top)
    state       = $state
    hwnd        = [string]$hwnd
} | ConvertTo-Json`;
  return tryJson(psRun(script, 12000));
}

async function windowHierarchy() {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinHier {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lp);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
}
'@ -ErrorAction SilentlyContinue
$roots = @()
$cb = [WinHier+EnumProc]{
    param($hwnd, $lp)
    if ([WinHier]::IsWindowVisible($hwnd)) {
        $sb = New-Object System.Text.StringBuilder(512)
        [WinHier]::GetWindowText($hwnd, $sb, 512) | Out-Null
        $cls = New-Object System.Text.StringBuilder(256)
        [WinHier]::GetClassName($hwnd, $cls, 256) | Out-Null
        $pid2 = [uint32]0
        [WinHier]::GetWindowThreadProcessId($hwnd, [ref]$pid2) | Out-Null
        $t = $sb.ToString()
        if ($t -ne '') {
            $script:roots += @{ hwnd=[string]$hwnd; title=$t; class=$cls.ToString(); pid=[int]$pid2 }
        }
    }
    return $true
}
[WinHier]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$roots | Select-Object -First 80 | ConvertTo-Json -Depth 2 -Compress`;
  return tryJson(psRun(script, 20000));
}

// ── Wave 3: File System Intelligence ─────────────────────────────────────────

function readFileLines(args) {
  if (!args.filePath) throw new Error('filePath required');
  const filePath = path.resolve(String(args.filePath));
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);

  const startLine = Math.max(1, Number.isFinite(args.startLine) ? args.startLine : 1);
  const endLine   = Number.isFinite(args.endLine) ? args.endLine : startLine + 199;
  const maxLines  = Math.min(endLine - startLine + 1, 500);

  const content = fs.readFileSync(filePath, 'utf8');
  const lines   = content.split('\n');
  const total   = lines.length;
  const sliced  = lines.slice(startLine - 1, startLine - 1 + maxLines);

  return {
    filePath,
    startLine,
    endLine:    startLine + sliced.length - 1,
    totalLines: total,
    truncated:  startLine + maxLines - 1 < endLine,
    lines:      sliced,
  };
}

function grepFile(args) {
  if (!args.filePath) throw new Error('filePath required');
  if (!args.pattern)  throw new Error('pattern required');
  const filePath   = path.resolve(String(args.filePath));
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const flags    = args.ignoreCase ? 'i' : '';
  const re       = new RegExp(args.pattern, flags);
  const maxMatch = Math.min(Number.isFinite(args.maxMatches) ? args.maxMatches : 100, 500);
  const content  = fs.readFileSync(filePath, 'utf8');
  const lines    = content.split('\n');
  const matches  = [];

  for (let i = 0; i < lines.length && matches.length < maxMatch; i++) {
    if (re.test(lines[i])) {
      matches.push({ lineNumber: i + 1, line: lines[i] });
    }
  }

  return {
    filePath,
    pattern:     args.pattern,
    ignoreCase:  Boolean(args.ignoreCase),
    totalLines:  lines.length,
    matchCount:  matches.length,
    truncated:   matches.length >= maxMatch,
    matches,
  };
}

function diffFiles(args) {
  if (!args.fileA) throw new Error('fileA required');
  if (!args.fileB) throw new Error('fileB required');
  const fileA = path.resolve(String(args.fileA));
  const fileB = path.resolve(String(args.fileB));
  if (!fs.existsSync(fileA)) throw new Error(`fileA not found: ${fileA}`);
  if (!fs.existsSync(fileB)) throw new Error(`fileB not found: ${fileB}`);

  const linesA = fs.readFileSync(fileA, 'utf8').split('\n');
  const linesB = fs.readFileSync(fileB, 'utf8').split('\n');

  // Simple unified-diff-style output (Myers-lite: line-level additions/removals)
  const hunks = [];
  const maxHunks = 200;
  let ia = 0, ib = 0;

  while ((ia < linesA.length || ib < linesB.length) && hunks.length < maxHunks) {
    if (ia < linesA.length && ib < linesB.length && linesA[ia] === linesB[ib]) {
      ia++; ib++;
    } else {
      // collect a block of differences
      const blockA = [], blockB = [];
      const startA = ia + 1, startB = ib + 1;
      while (ia < linesA.length || ib < linesB.length) {
        if (ia < linesA.length && ib < linesB.length && linesA[ia] === linesB[ib]) break;
        if (ia < linesA.length) blockA.push(linesA[ia++]);
        if (ib < linesB.length) blockB.push(linesB[ib++]);
      }
      hunks.push({ startA, startB, removed: blockA, added: blockB });
    }
  }

  return {
    fileA, fileB,
    linesA: linesA.length,
    linesB: linesB.length,
    identical: hunks.length === 0,
    hunkCount: hunks.length,
    truncated: hunks.length >= maxHunks,
    hunks,
  };
}

function hashFile(args) {
  if (!args.filePath) throw new Error('filePath required');
  const filePath  = path.resolve(String(args.filePath));
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const algorithm = (args.algorithm || 'sha256').toLowerCase();
  if (!['md5', 'sha1', 'sha256', 'sha512'].includes(algorithm)) {
    throw new Error('algorithm must be md5, sha1, sha256, or sha512');
  }
  const crypto = require('crypto');
  const buf    = fs.readFileSync(filePath);
  const hash   = crypto.createHash(algorithm).update(buf).digest('hex');
  const stat   = fs.statSync(filePath);
  return { filePath, algorithm, hash, sizeBytes: stat.size };
}

function watchFileChanges(args) {
  if (!args.filePath) throw new Error('filePath required');
  const filePath = path.resolve(String(args.filePath));
  const exists   = fs.existsSync(filePath);
  if (!exists) {
    return { filePath, exists: false, sizeBytes: null, mtimeMs: null, mtimeIso: null };
  }
  const stat = fs.statSync(filePath);
  return {
    filePath,
    exists:    true,
    sizeBytes: stat.size,
    mtimeMs:   stat.mtimeMs,
    mtimeIso:  new Date(stat.mtimeMs).toISOString(),
    mode:      stat.mode.toString(8),
  };
}

// ── System Diagnostics ────────────────────────────────────────────────────

async function checkServiceStatus(args) {
  if (!args.name) throw new Error('name required');
  const name = String(args.name).replace(/'/g, "''");
  const script = `
$svc = Get-Service -Name '${name}' -ErrorAction SilentlyContinue
if (-not $svc) { Write-Output (ConvertTo-Json @{ found=$false; name='${name}' }) } else {
  Write-Output (ConvertTo-Json @{
    found=$true; name=$svc.Name; displayName=$svc.DisplayName
    status=$svc.Status.ToString(); startType=$svc.StartType.ToString()
  })
}`;
  const raw = await psRun(script, 10000);
  return tryJson(raw.trim()) || { found: false, name: args.name, raw };
}

async function getInstalledSoftware(args) {
  const filter  = args.filter ? String(args.filter).replace(/'/g, "''") : '';
  const limitN  = Math.min(parseInt(args.limit) || 100, 500);
  const script = `
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$apps = Get-ItemProperty $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName } |
  ${filter ? `Where-Object { $_.DisplayName -match '${filter}' } |` : ''}
  Select-Object DisplayName, DisplayVersion, Publisher, InstallDate |
  Sort-Object DisplayName |
  Select-Object -First ${limitN}
Write-Output (ConvertTo-Json $apps -Compress)`;
  const raw = await psRun(script, 15000);
  const items = tryJson(raw.trim());
  const list = Array.isArray(items) ? items : (items ? [items] : []);
  return { count: list.length, filter: filter || null, software: list };
}

async function getStartupItems() {
  const script = `
$items = @()
$runKeys = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'
)
foreach ($key in $runKeys) {
  $props = Get-ItemProperty $key -ErrorAction SilentlyContinue
  if ($props) {
    $props.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
      $items += @{ name=$_.Name; command=$_.Value; hive=$key }
    }
  }
}
Write-Output (ConvertTo-Json $items -Compress)`;
  const raw = await psRun(script, 10000);
  const items = tryJson(raw.trim());
  const list = Array.isArray(items) ? items : (items ? [items] : []);
  return { count: list.length, items: list };
}

async function getEventLogEntries(args) {
  const logName  = args.logName ? String(args.logName).replace(/'/g, "''") : 'Application';
  const limitN   = Math.min(parseInt(args.limit) || 20, 200);
  const level    = args.level ? String(args.level) : null; // Error, Warning, Information
  const levelFilter = level ? `| Where-Object { $_.EntryType -eq '${level}' }` : '';
  const script = `
$entries = Get-EventLog -LogName '${logName}' -Newest 200 -ErrorAction SilentlyContinue ${levelFilter} |
  Select-Object -First ${limitN} |
  ForEach-Object {
    @{ timeGenerated=$_.TimeGenerated.ToString('o'); entryType=$_.EntryType.ToString()
       source=$_.Source; eventId=$_.EventID; message=($_.Message -replace '\\r|\\n',' ').Substring(0, [Math]::Min(200,$_.Message.Length)) }
  }
if (-not $entries) { $entries = @() }
Write-Output (ConvertTo-Json @($entries) -Compress)`;
  const raw = await psRun(script, 15000);
  const entries = tryJson(raw.trim());
  const list = Array.isArray(entries) ? entries : (entries ? [entries] : []);
  return { logName, level: level || 'all', count: list.length, entries: list };
}

function summarizeWorkflowResultData(data) {
  if (data && data._isImage) {
    return {
      kind: 'image',
      mimeType: data.mimeType || 'image/png',
      warning: data.warning || null,
    };
  }

  if (typeof data === 'string') {
    return {
      kind: 'text',
      preview: data.length > 300 ? `${data.slice(0, 297)}...` : data,
    };
  }

  return {
    kind: 'json',
    data,
  };
}

async function workflowRunbookExecute(args) {
  const steps = Array.isArray(args.steps) ? args.steps : [];
  if (steps.length === 0) throw new Error('steps must be a non-empty array');

  const maxSteps = Math.min(parseInt(args.maxSteps) || 50, 100);
  if (steps.length > maxSteps) {
    throw new Error(`steps length ${steps.length} exceeds maxSteps ${maxSteps}`);
  }

  const stopOnFail = args.stopOnFail !== false;
  const maxTotalMs = Math.min(parseInt(args.maxTotalMs) || 120000, 600000);
  const startedAtMs = Date.now();
  const runId = crypto.randomUUID();

  const results = [];
  let aborted = false;
  let abortReason = null;

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx] || {};
    const stepNo = idx + 1;
    const tool = String(step.tool || '').trim();
    const toolArgs = (step.arguments && typeof step.arguments === 'object') ? step.arguments : {};
    const retries = Math.max(0, Math.min(5, parseInt(step.retries) || 0));
    const continueOnError = step.continueOnError === true;
    const stepTimeoutMs = Math.max(250, Math.min(120000, parseInt(step.timeoutMs) || 0));

    if (Date.now() - startedAtMs > maxTotalMs) {
      aborted = true;
      abortReason = `maxTotalMs exceeded before step ${stepNo}`;
      break;
    }

    if (!tool) {
      results.push({
        step: stepNo,
        tool,
        status: 'failed',
        attempts: 0,
        error: normalizeToolError(new Error('step.tool is required'), 'workflow_runbook_execute'),
      });
      if (stopOnFail && !continueOnError) {
        aborted = true;
        abortReason = `step ${stepNo} missing tool`;
        break;
      }
      continue;
    }

    if (tool === 'workflow_runbook_execute') {
      results.push({
        step: stepNo,
        tool,
        status: 'failed',
        attempts: 0,
        error: normalizeToolError(new Error('workflow_runbook_execute cannot call itself'), tool),
      });
      if (stopOnFail && !continueOnError) {
        aborted = true;
        abortReason = `step ${stepNo} attempted recursive workflow call`;
        break;
      }
      continue;
    }

    let attempt = 0;
    let succeeded = false;
    let lastErr = null;
    let lastData = null;

    while (attempt <= retries && !succeeded) {
      attempt++;
      try {
        const runStep = async () => {
          const def = getToolDefinitionByName(tool);
          if (!def) throw new Error(`Unknown tool: ${tool}`);
          validateToolCallParams(tool, toolArgs);
          return handleTool(tool, toolArgs);
        };

        if (stepTimeoutMs > 0) {
          lastData = await Promise.race([
            runStep(),
            new Promise((_, reject) => setTimeout(() => reject(new ToolContractError({
              code: 'tool_timeout',
              category: 'timeout',
              message: `Step ${stepNo} timed out after ${stepTimeoutMs}ms`,
              retryable: true,
              suggestedAction: 'Increase step timeoutMs or split into smaller operations.',
            })), stepTimeoutMs)),
          ]);
        } else {
          lastData = await runStep();
        }
        succeeded = true;
      } catch (err) {
        lastErr = normalizeToolError(err, tool);
      }
    }

    if (succeeded) {
      results.push({
        step: stepNo,
        tool,
        status: 'succeeded',
        attempts: attempt,
        continueOnError,
        note: step.note || null,
        result: summarizeWorkflowResultData(lastData),
      });
      continue;
    }

    results.push({
      step: stepNo,
      tool,
      status: 'failed',
      attempts: attempt,
      continueOnError,
      note: step.note || null,
      error: {
        code: lastErr.code,
        category: lastErr.category,
        message: lastErr.message,
        retryable: lastErr.retryable,
        suggestedAction: lastErr.suggestedAction,
        details: lastErr.details || null,
      },
    });

    if (stopOnFail && !continueOnError) {
      aborted = true;
      abortReason = `step ${stepNo} failed: ${lastErr.message}`;
      break;
    }
  }

  const finishedAtMs = Date.now();
  const succeeded = results.filter((r) => r.status === 'succeeded').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const executedSteps = results.length;

  return {
    runId,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    stopOnFail,
    maxSteps,
    maxTotalMs,
    aborted,
    abortReason,
    completedAllSteps: !aborted && executedSteps === steps.length,
    summary: {
      totalSteps: steps.length,
      executedSteps,
      succeeded,
      failed,
    },
    steps: results,
  };
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
    name: 'process_resource_hotspots',
    description: 'Return top CPU and memory process hotspots for quick triage.',
    inputSchema: {
      type: 'object',
      properties: {
        topN: { type: 'number', description: 'Rows per ranking bucket (default 10, max 100)' },
      },
    },
  },
  {
    name: 'wait_for_process_state',
    description: 'Wait until a process becomes running or stopped by PID or process name.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process id' },
        name: { type: 'string', description: 'Target process name (e.g. node, chrome)' },
        desiredState: { type: 'string', enum: ['running', 'stopped'], description: 'Target state (default running)' },
        timeoutMs: { type: 'number', description: 'Max wait time in milliseconds (default 10000)' },
        pollMs: { type: 'number', description: 'Polling interval in milliseconds (default 250)' },
      },
    },
  },
  {
    name: 'process_tree',
    description: 'Build a process tree snapshot rooted by PID or processName.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Root process id' },
        processName: { type: 'string', description: 'Root process name substring' },
        maxNodes: { type: 'number', description: 'Max nodes to include (default 200, max 500)' },
      },
    },
  },
  {
    name: 'process_network_map',
    description: 'Map active TCP connections to owning processes with aggregate counts.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max connection rows sampled (default 200, max 1000)' },
      },
    },
  },
  // ── Window Intelligence ────────────────────────────────────────────────────
  {
    name: 'list_windows_detailed',
    description: 'List all visible top-level windows with full metadata: title, PID, class, position, size, and state (normal/minimized/maximized).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'move_resize_window',
    description: 'Move and/or resize a window by pid, hwnd, or title. Omit any of x/y/width/height to keep that dimension unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        pid:    { type: 'number', description: 'Target window process ID (preferred for reliability)' },
        hwnd:   { type: 'string', description: 'Target window handle as decimal string' },
        title:  { type: 'string', description: 'Substring of the window title to match' },
        x:      { type: 'number', description: 'New left edge (pixels)' },
        y:      { type: 'number', description: 'New top edge (pixels)' },
        width:  { type: 'number', description: 'New window width (pixels)' },
        height: { type: 'number', description: 'New window height (pixels)' },
      },
    },
  },
  {
    name: 'minimize_maximize_window',
    description: 'Minimize, maximize, or restore a window by pid, hwnd, or title.',
    inputSchema: {
      type: 'object',
      properties: {
        pid:    { type: 'number', description: 'Target window process ID (preferred for reliability)' },
        hwnd:   { type: 'string', description: 'Target window handle as decimal string' },
        title:  { type: 'string', description: 'Substring of the window title to match' },
        action: { type: 'string', enum: ['minimize', 'maximize', 'restore'], description: 'Action to perform (default: minimize)' },
      },
    },
  },
  {
    name: 'get_focused_app_state',
    description: 'Return full context for the currently focused window: title, PID, process name, executable path, position, size, and window state.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'window_hierarchy',
    description: 'Enumerate all visible top-level windows with their hwnd, title, Win32 class name, and PID (up to 80 entries).',
    inputSchema: { type: 'object', properties: {} },
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
  // ── File System Intelligence ───────────────────────────────────────────────
  {
    name: 'read_file_lines',
    description: 'Read a specific line range from a file. Ideal for large files where you only need a portion.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath:  { type: 'string', description: 'Absolute path to file' },
        startLine: { type: 'number', description: '1-based start line (default: 1)' },
        endLine:   { type: 'number', description: '1-based end line inclusive (default: startLine + 199, max 500 lines returned)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'grep_file',
    description: 'Search a file for lines matching a regex pattern. Returns matching lines with their line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath:   { type: 'string', description: 'Absolute path to file' },
        pattern:    { type: 'string', description: 'JavaScript regex pattern' },
        ignoreCase: { type: 'boolean', description: 'Case-insensitive match (default: false)' },
        maxMatches: { type: 'number', description: 'Max matching lines to return (default 100, max 500)' },
      },
      required: ['filePath', 'pattern'],
    },
  },
  {
    name: 'diff_files',
    description: 'Compare two files line-by-line and return a structured diff with added/removed hunks.',
    inputSchema: {
      type: 'object',
      properties: {
        fileA: { type: 'string', description: 'Absolute path to first file' },
        fileB: { type: 'string', description: 'Absolute path to second file' },
      },
      required: ['fileA', 'fileB'],
    },
  },
  {
    name: 'hash_file',
    description: 'Compute a cryptographic hash (MD5, SHA1, SHA256, or SHA512) of a file.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath:  { type: 'string', description: 'Absolute path to file' },
        algorithm: { type: 'string', enum: ['md5', 'sha1', 'sha256', 'sha512'], description: 'Hash algorithm (default: sha256)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'watch_file_changes',
    description: 'Stat a file and return its current size and modification time. Useful for polling a file for changes between calls.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to file' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'get_screen_size',
    description: 'Get the pixel dimensions of all connected monitors.',
    inputSchema: { type: 'object', properties: {} },
  },
  // ── System Diagnostics ────────────────────────────────────────────────────
  {
    name: 'check_service_status',
    description: 'Query the status of a Windows service by name. Returns status, displayName, and startType.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Service short name, e.g. "wuauserv" or "Spooler"' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_installed_software',
    description: 'List installed programs from the Windows registry uninstall keys.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional regex filter on DisplayName' },
        limit:  { type: 'number', description: 'Max results (default 100, max 500)' },
      },
    },
  },
  {
    name: 'get_startup_items',
    description: 'List programs configured to run at Windows startup from registry Run keys.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_event_log_entries',
    description: 'Read recent Windows Event Log entries from Application or System log.',
    inputSchema: {
      type: 'object',
      properties: {
        logName: { type: 'string', description: 'Log name: Application (default), System, Security' },
        level:   { type: 'string', description: 'Filter by level: Error, Warning, Information' },
        limit:   { type: 'number', description: 'Max entries (default 20, max 200)' },
      },
    },
  },
  {
    name: 'workflow_runbook_execute',
    description: 'Execute a multi-step MCP runbook with retries, per-step timeout, and stop/continue policies.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Ordered list of tool steps to execute',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: 'Tool name to execute' },
              arguments: { type: 'object', description: 'Arguments to pass into the tool' },
              retries: { type: 'number', description: 'Retry attempts after first failure (default 0)', minimum: 0, maximum: 5 },
              timeoutMs: { type: 'number', description: 'Per-step timeout in ms (default 0 = no local timeout)', minimum: 0, maximum: 120000 },
              continueOnError: { type: 'boolean', description: 'Continue runbook if this step fails (default false)' },
              note: { type: 'string', description: 'Optional operator note for this step' },
            },
            required: ['tool'],
            additionalProperties: false,
          },
        },
        stopOnFail: { type: 'boolean', description: 'Stop workflow on first failed step unless step has continueOnError=true (default true)' },
        maxSteps: { type: 'number', description: 'Maximum allowed steps for this workflow run (default 50, max 100)', minimum: 1, maximum: 100 },
        maxTotalMs: { type: 'number', description: 'Maximum total workflow duration in ms (default 120000, max 600000)', minimum: 1000, maximum: 600000 },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  },

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
    description: 'Bring a window to the foreground by pid, hwnd, or title (partial, case-insensitive).',
    inputSchema: {
      type: 'object',
      properties: {
        pid:   { type: 'number', description: 'Target window process ID (preferred for reliability)' },
        hwnd:  { type: 'string', description: 'Target window handle as decimal string' },
        title: { type: 'string', description: 'Partial window title to match' },
      },
    },
  },
  {
    name: 'get_active_window',
    description: 'Get the title, PID, and process name of the currently focused window.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'close_window',
    description: 'Send a graceful close (WM_CLOSE) to a window matched by pid, hwnd, or title. The app may prompt to save.',
    inputSchema: {
      type: 'object',
      properties: {
        pid:   { type: 'number', description: 'Target window process ID (preferred for reliability)' },
        hwnd:  { type: 'string', description: 'Target window handle as decimal string' },
        title: { type: 'string', description: 'Partial window title to match' },
      },
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
    description: 'Get the screen coordinates and dimensions of a window by pid, hwnd, or title. Returns {x, y, width, height, pid, processName, title, matchedBy}.',
    inputSchema: {
      type: 'object',
      properties: {
        pid:   { type: 'number', description: 'Target window process ID (preferred for reliability)' },
        hwnd:  { type: 'string', description: 'Target window handle as decimal string' },
        title: { type: 'string', description: 'Window title pattern (partial match, case-insensitive)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'screenshot_window',
    description: 'Capture a screenshot of a specific window by pid, hwnd, or title. Focuses and crops to the window bounds. Falls back to full screen if no target is found.',
    inputSchema: {
      type: 'object',
      properties: {
        pid:   { type: 'number', description: 'Target window process ID (preferred for reliability)' },
        hwnd:  { type: 'string', description: 'Target window handle as decimal string' },
        title: { type: 'string', description: 'Window title pattern (partial match, case-insensitive)' },
      },
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

// ── Prompts ───────────────────────────────────────────────────────────────────
const PROMPTS = [
  {
    name: 'automate_app',
    description: 'Generate a step-by-step automation plan for a Windows application.',
    arguments: [
      { name: 'appName', description: 'Name of the application to automate', required: true },
      { name: 'goal',    description: 'What you want to accomplish',          required: true },
    ],
  },
  {
    name: 'find_memory_hogs',
    description: 'Diagnose high memory usage — lists top processes and suggests next steps.',
    arguments: [],
  },
  {
    name: 'monitor_file',
    description: 'Set up a file monitoring workflow — polls size/mtime and alerts on change.',
    arguments: [
      { name: 'filePath',      description: 'Absolute path to the file to watch', required: true },
      { name: 'intervalSecs',  description: 'Poll interval in seconds (default 10)', required: false },
    ],
  },
  {
    name: 'debug_slow_startup',
    description: 'Investigate slow Windows startup — checks startup items, services, and resource usage.',
    arguments: [],
  },
  {
    name: 'capture_window_state',
    description: 'Capture a snapshot of all open windows (title, size, position, PID) for later restore.',
    arguments: [],
  },
  {
    name: 'continuous_mcp_improvement',
    description: 'Run a continuous MCP improvement loop using workflow_runbook_execute with verification and refinement cycles.',
    arguments: [
      { name: 'focus', description: 'Primary focus area (contracts, shell safety, prompts, workflows)', required: false },
      { name: 'maxCycles', description: 'How many cycles to run (default 3)', required: false },
    ],
  },
];

function getPromptMessages(name, args) {
  switch (name) {
    case 'automate_app': {
      const app  = (args && args.appName) || 'the application';
      const goal = (args && args.goal)    || 'complete the task';
      return [{ role: 'user', content: { type: 'text', text:
        `I need to automate "${app}" to: ${goal}\n\n` +
        `Please help me by:\n` +
        `1. Using list_windows or list_windows_detailed to check if "${app}" is already open\n` +
        `2. Using focus_window or get_focused_app_state to bring it into focus\n` +
        `3. Breaking the goal into discrete UI steps (click, type_text, press_key)\n` +
        `4. Confirming each step with take_screenshot before proceeding\n` +
        `5. Suggesting error recovery if a step fails`
      } }];
    }
    case 'find_memory_hogs': {
      return [{ role: 'user', content: { type: 'text', text:
        `Diagnose high memory usage on this Windows machine.\n\n` +
        `Steps:\n` +
        `1. Call get_processes with sortBy="memory" and limit=10\n` +
        `2. Call process_resource_hotspots to identify CPU+memory hotspots\n` +
        `3. For each top process, call process_tree with its PID to see child processes\n` +
        `4. Report: which processes are consuming the most memory, whether any are unexpected, and recommended actions (kill, restart service, etc.)`
      } }];
    }
    case 'monitor_file': {
      const fp      = (args && args.filePath)     || '<file>';
      const secs    = parseInt((args && args.intervalSecs) || '10') || 10;
      return [{ role: 'user', content: { type: 'text', text:
        `Monitor the file: ${fp}\nPoll every ${secs} seconds.\n\n` +
        `Workflow:\n` +
        `1. Call watch_file_changes with filePath="${fp}" to get baseline (sizeBytes, mtimeMs)\n` +
        `2. After ${secs}s, call watch_file_changes again and compare mtimeMs\n` +
        `3. If changed: call read_file_lines with the last 20 lines to show what changed\n` +
        `4. Report: whether the file changed, new size, new mtime, and a diff if content changed`
      } }];
    }
    case 'debug_slow_startup': {
      return [{ role: 'user', content: { type: 'text', text:
        `Investigate why Windows is starting up slowly.\n\n` +
        `Steps:\n` +
        `1. Call get_startup_items to list all registry Run-key startup programs\n` +
        `2. Call get_installed_software with filter="update|helper|agent|launcher" (limit=20) to find background agents\n` +
        `3. Call check_service_status for common slow-start services: "SysMain","WSearch","wuauserv","DiagTrack"\n` +
        `4. Call get_event_log_entries with logName="System", level="Error", limit=10 for boot-time errors\n` +
        `5. Summarize: which startup items are unnecessary, which services are slow/erroring, and recommended disables`
      } }];
    }
    case 'capture_window_state': {
      return [{ role: 'user', content: { type: 'text', text:
        `Capture a full snapshot of the current window layout.\n\n` +
        `Steps:\n` +
        `1. Call list_windows_detailed to get all visible windows with title/pid/x/y/width/height/state\n` +
        `2. Call window_hierarchy to get the parent-child relationships\n` +
        `3. Format the results as a table: PID | Title | Position (x,y) | Size (w×h) | State\n` +
        `4. Save the JSON to a file using write_file so it can be used to restore the layout later`
      } }];
    }
    case 'continuous_mcp_improvement': {
      const focus = (args && args.focus) ? String(args.focus) : 'contracts';
      const cycles = Math.max(1, Math.min(10, parseInt((args && args.maxCycles) || '3') || 3));
      return [{ role: 'user', content: { type: 'text', text:
        `Run a continuous MCP improvement workflow focused on: ${focus}.\n\n` +
        `Loop for ${cycles} cycle(s):\n` +
        `1. Use workflow_runbook_execute to run a cycle with steps:\n` +
        `   - get_system_info\n` +
        `   - get_processes (limit=10, sortBy=memory)\n` +
        `   - get_event_log_entries (Application, Error, limit=10)\n` +
        `2. Identify one concrete reliability/usability improvement from outputs\n` +
        `3. Implement the improvement\n` +
        `4. Run verification tests\n` +
        `5. Record what changed and continue to next cycle until complete`
      } }];
    }
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

async function handleTool(name, args) {
  switch (name) {
    case 'get_system_info':     return getSystemInfo();
    case 'get_processes':       return getProcesses(args);
    case 'process_resource_hotspots': return processResourceHotspots(args);
    case 'wait_for_process_state': return waitForProcessState(args);
    case 'process_tree':        return processTree(args);
    case 'process_network_map': return processNetworkMap(args);
    case 'list_windows_detailed':   return listWindowsDetailed();
    case 'move_resize_window':      return moveResizeWindow(args);
    case 'minimize_maximize_window':return minimizeMaximizeWindow(args);
    case 'get_focused_app_state':   return getFocusedAppState();
    case 'window_hierarchy':        return windowHierarchy();
    case 'kill_process':        return killProcess(args);
    case 'get_open_ports':      return getOpenPorts();
    case 'search_files':        return searchFiles(args);
    case 'read_file_lines':     return readFileLines(args);
    case 'grep_file':           return grepFile(args);
    case 'diff_files':          return diffFiles(args);
    case 'hash_file':           return hashFile(args);
    case 'watch_file_changes':  return watchFileChanges(args);
    case 'check_service_status':     return checkServiceStatus(args);
    case 'get_installed_software':   return getInstalledSoftware(args);
    case 'get_startup_items':        return getStartupItems();
    case 'get_event_log_entries':    return getEventLogEntries(args);
    case 'workflow_runbook_execute': return workflowRunbookExecute(args);
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
  const structured = { ok: true, data };
  const text = JSON.stringify(structured, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: structured, isError: false };
}

function makeErrorResult(err, toolName) {
  const tErr = normalizeToolError(err, toolName);
  const structured = {
    ok: false,
    toolName: toolName || null,
    error: {
      code: tErr.code,
      category: tErr.category,
      message: tErr.message,
      retryable: tErr.retryable,
      suggestedAction: tErr.suggestedAction,
      details: tErr.details,
    },
  };
  return {
    content: [{ type: 'text', text: tErr.message }],
    structuredContent: structured,
    isError: true,
  };
}

function makeImageResult(data) {
  const content = [{ type: 'image', data: data.data, mimeType: data.mimeType }];
  if (data.warning) {
    content.push({ type: 'text', text: data.warning });
  }
  return {
    content,
    structuredContent: {
      ok: true,
      imageMeta: {
        mimeType: data.mimeType,
        fallbackUsed: Boolean(data.warning),
        warning: data.warning || null,
        matchedBy: data.matchedBy || null,
      },
    },
    isError: false,
  };
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
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: 'os-bridge', version: SERVER_VERSION },
        };
        break;

      case 'tools/list':
        result = { tools: TOOLS };
        break;

      case 'prompts/list':
        result = { prompts: PROMPTS };
        break;

      case 'prompts/get': {
        const promptName = params && params.name;
        const promptArgs = (params && params.arguments) || {};
        try {
          const messages = getPromptMessages(promptName, promptArgs);
          result = { description: (PROMPTS.find(p => p.name === promptName) || {}).description || '', messages };
        } catch (err) {
          send({ jsonrpc: '2.0', id, error: { code: -32602, message: err.message } });
          return;
        }
        break;
      }

      case 'tools/call': {
        const toolName = params && params.name;
        const toolArgs = (params && Object.prototype.hasOwnProperty.call(params, 'arguments')) ? params.arguments : {};
        try {
          const validated = validateToolCallParams(toolName, toolArgs);
          const data = await handleTool(toolName, validated.args);
          // Screenshot returns image content
          if (data && data._isImage) {
            result = makeImageResult(data);
          } else {
            result = makeResult(data);
          }
        } catch (err) {
          result = makeErrorResult(err, toolName);
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
