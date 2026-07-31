'use strict';

const fs = require('fs');
const path = require('path');
const { McpClient } = require('./tests/lib/mcp-client');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    plan: null,
    outDir: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--plan' && argv[i + 1]) {
      args.plan = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--out-dir' && argv[i + 1]) {
      args.outDir = argv[i + 1];
      i += 1;
    }
  }

  if (!args.plan) {
    throw new Error('Missing required --plan <file> argument.');
  }

  return args;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function savePng(filePath, base64Data) {
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
}

function sanitizeName(value) {
  return String(value || 'step').replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

async function getWindowRect(client, selector) {
  const resp = await client.callTool('get_window_rect', selector || {});
  if (!resp.ok || !resp.json) {
    throw new Error(resp.error || 'get_window_rect failed');
  }
  return resp.json;
}

function toSelector(selector) {
  if (!selector || typeof selector !== 'object') return {};
  const out = {};
  if (Number.isFinite(selector.pid)) out.pid = selector.pid;
  if (selector.hwnd) out.hwnd = String(selector.hwnd);
  if (selector.title) out.title = String(selector.title);
  return out;
}

async function runStep(client, step, stepDir, index) {
  const record = {
    index,
    id: step.id || `step-${index + 1}`,
    kind: step.kind || 'tool',
    startedAt: nowIso(),
  };

  switch (step.kind) {
    case 'wait': {
      const delayMs = Number.isFinite(step.delayMs) ? Number(step.delayMs) : 1000;
      await sleep(delayMs);
      record.delayMs = delayMs;
      record.result = { waited: true };
      break;
    }

    case 'focus': {
      const selector = toSelector(step.selector);
      const resp = await client.callTool('focus_window', selector);
      if (!resp.ok) throw new Error(resp.error || 'focus_window failed');
      record.selector = selector;
      record.result = resp.json || resp.text || null;
      break;
    }

    case 'click-relative': {
      const selector = toSelector(step.selector);
      const rect = await getWindowRect(client, selector);
      const x = Math.round(rect.x + Number(step.offsetX || 0));
      const y = Math.round(rect.y + Number(step.offsetY || 0));
      const args = { x, y, button: step.button || 'left', double: step.double === true };
      const resp = await client.callTool('click_mouse', args);
      if (!resp.ok) throw new Error(resp.error || 'click_mouse failed');
      record.selector = selector;
      record.rect = rect;
      record.args = args;
      record.result = resp.json || resp.text || null;
      break;
    }

    case 'tool': {
      const resp = await client.callTool(step.tool, step.args || {}, step.timeoutMs || 30000);
      if (!resp.ok) throw new Error(resp.error || `${step.tool} failed`);
      record.tool = step.tool;
      record.args = step.args || {};
      record.result = resp.json || resp.text || null;
      break;
    }

    case 'assert-active-window': {
      const resp = await client.callTool('get_active_window', {});
      if (!resp.ok || !resp.json) throw new Error(resp.error || 'get_active_window failed');
      const title = String(resp.json.title || '');
      const expected = String(step.titleIncludes || '');
      if (expected && !title.toLowerCase().includes(expected.toLowerCase())) {
        throw new Error(`Expected active window title to include "${expected}", got "${title}"`);
      }
      record.result = resp.json;
      break;
    }

    case 'capture-screen': {
      const resp = await client.callTool('take_screenshot', step.args || {}, step.timeoutMs || 30000);
      if (!resp.ok || !resp.image) throw new Error(resp.error || 'take_screenshot failed');
      const filePath = path.join(stepDir, `${sanitizeName(step.fileName || record.id)}.png`);
      savePng(filePath, resp.image.data);
      record.result = { filePath, meta: resp.json || null };
      break;
    }

    case 'capture-window': {
      const selector = toSelector(step.selector);
      const resp = await client.callTool('screenshot_window', selector, step.timeoutMs || 30000);
      if (!resp.ok || !resp.image) throw new Error(resp.error || 'screenshot_window failed');
      const filePath = path.join(stepDir, `${sanitizeName(step.fileName || record.id)}.png`);
      savePng(filePath, resp.image.data);
      record.selector = selector;
      record.result = { filePath, meta: resp.json || null };
      break;
    }

    default:
      throw new Error(`Unsupported live-runner step kind: ${step.kind}`);
  }

  record.completedAt = nowIso();
  saveJson(path.join(stepDir, 'result.json'), record);
  return record;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const planPath = path.resolve(args.plan);
  const plan = loadJson(planPath);
  const outDir = path.resolve(args.outDir || plan.outDir || path.join(path.dirname(planPath), `${sanitizeName(plan.id || 'live-run')}-${Date.now()}`));
  ensureDir(outDir);

  const summaryPath = path.join(outDir, 'summary.json');
  const stepResults = [];
  saveJson(summaryPath, {
    status: 'running',
    startedAt: nowIso(),
    planPath,
    outDir,
  });

  const client = new McpClient(path.resolve(__dirname, 'mcp-server.js'));
  await client.start();

  try {
    if (plan.executionProfile) {
      const resp = await client.callTool('set_execution_profile', plan.executionProfile);
      if (!resp.ok) throw new Error(resp.error || 'set_execution_profile failed');
    }

    for (let i = 0; i < (plan.steps || []).length; i += 1) {
      const step = plan.steps[i];
      const stepId = sanitizeName(step.id || `step-${i + 1}`);
      const stepDir = path.join(outDir, `${String(i + 1).padStart(3, '0')}-${stepId}`);
      ensureDir(stepDir);
      const result = await runStep(client, step, stepDir, i);
      stepResults.push(result);
      saveJson(summaryPath, {
        status: 'running',
        startedAt: plan.startedAt || null,
        updatedAt: nowIso(),
        planPath,
        outDir,
        completedSteps: stepResults.length,
        steps: stepResults,
      });
    }

    saveJson(summaryPath, {
      status: 'completed',
      completedAt: nowIso(),
      planPath,
      outDir,
      completedSteps: stepResults.length,
      steps: stepResults,
    });
  } catch (error) {
    saveJson(summaryPath, {
      status: 'failed',
      failedAt: nowIso(),
      planPath,
      outDir,
      completedSteps: stepResults.length,
      steps: stepResults,
      error: error.stack || error.message,
    });
    throw error;
  } finally {
    try {
      await client.callTool('set_execution_profile', { mode: 'quiet', announceActions: false });
    } catch {}
    await client.stop();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
