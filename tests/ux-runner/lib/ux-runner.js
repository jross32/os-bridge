'use strict';

const path = require('path');
const {
  ensureDir,
  safeReadJson,
  writeJson,
  writePngBase64,
  writeText,
} = require('./artifacts');
const { buildPaths, stepFolderName, timestamp } = require('./paths');
const { validateScenario, validateProfile } = require('./schema-validator');
const { McpClient } = require('../../lib/mcp-client');
const { normalizeControlState } = require('../../lib/test-helpers');

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = {
    scenario: null,
    profile: null,
    visible: false,
    resume: false,
    stopAfter: null,
    approveHighRisk: false,
    approveCriticalRisk: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--scenario' && argv[i + 1]) args.scenario = argv[++i];
    else if (v === '--profile' && argv[i + 1]) args.profile = argv[++i];
    else if (v === '--visible') args.visible = true;
    else if (v === '--resume') args.resume = true;
    else if (v === '--stop-after' && argv[i + 1]) args.stopAfter = parseInt(argv[++i], 10);
    else if (v === '--approve-high-risk') args.approveHighRisk = true;
    else if (v === '--approve-critical-risk') args.approveCriticalRisk = true;
  }
  return args;
}

function classifyToolRisk(toolName) {
  const high = new Set(['click_mouse', 'drag_mouse', 'type_text', 'press_key', 'focus_window', 'close_window']);
  const critical = new Set(['run_command', 'kill_process']);
  if (critical.has(toolName)) return 'critical';
  if (high.has(toolName)) return 'high';
  return 'low';
}

function enforceRiskPolicy(step, profile, cliFlags) {
  const runner = profile.runner || {};
  const policy = runner.riskPolicy || {};
  const risk = step.risk || classifyToolRisk(step.tool);
  const requiresConfirmation = step.requiresConfirmation === true || risk === 'high' || risk === 'critical';

  if (!requiresConfirmation) {
    return { allowed: true, risk, reason: 'No explicit confirmation required' };
  }

  if (risk === 'low') {
    return { allowed: !!policy.autoApproveLow, risk, reason: policy.autoApproveLow ? 'Auto-approved low risk step' : 'Low risk step requires approval by policy' };
  }

  if (risk === 'medium') {
    return { allowed: !!policy.autoApproveMedium, risk, reason: policy.autoApproveMedium ? 'Auto-approved medium risk step' : 'Medium risk step requires approval by policy' };
  }

  if (risk === 'high') {
    const approved = cliFlags.approveHighRisk || policy.requireApprovalForHigh === false;
    return {
      allowed: approved,
      risk,
      reason: approved
        ? 'High risk step approved'
        : 'High risk step requires --approve-high-risk (or profile override)'
    };
  }

  const approved = cliFlags.approveCriticalRisk || policy.requireApprovalForCritical === false;
  return {
    allowed: approved,
    risk,
    reason: approved
      ? 'Critical risk step approved'
      : 'Critical risk step requires --approve-critical-risk (or profile override)'
  };
}

function imageStats(base64Data) {
  const buf = Buffer.from(base64Data || '', 'base64');
  const len = buf.length;
  let checksum = 0;
  for (let i = 0; i < len; i++) {
    checksum = (checksum + buf[i]) % 1000000007;
  }
  return { byteLength: len, checksum };
}

function diffStats(prevStats, nextStats) {
  if (!prevStats || !nextStats) return null;
  const byteDelta = nextStats.byteLength - prevStats.byteLength;
  const checksumDelta = nextStats.checksum - prevStats.checksum;
  return { byteDelta, checksumDelta };
}

function normalizeRunResult(result) {
  if (!result) return { ok: false, error: 'Empty tool result' };
  return result;
}

function evaluateExpectation(step, result) {
  const exp = step.expect || {};

  if (typeof exp.ok === 'boolean' && result.ok !== exp.ok) {
    return { pass: false, reason: `Expected ok=${exp.ok} but got ok=${result.ok}` };
  }

  if (exp.containsText) {
    const text = String(result.text || '');
    if (!text.includes(exp.containsText)) {
      return { pass: false, reason: `Expected text to include: ${exp.containsText}` };
    }
  }

  if (exp.containsError) {
    const err = String(result.error || '');
    if (!err.toLowerCase().includes(String(exp.containsError).toLowerCase())) {
      return { pass: false, reason: `Expected error to include: ${exp.containsError}` };
    }
  }

  if (Array.isArray(exp.jsonHasKeys)) {
    if (!result.json || typeof result.json !== 'object') {
      return { pass: false, reason: 'Expected JSON object for jsonHasKeys check' };
    }
    for (const key of exp.jsonHasKeys) {
      if (!Object.prototype.hasOwnProperty.call(result.json, key)) {
        return { pass: false, reason: `Expected JSON key missing: ${key}` };
      }
    }
  }

  return { pass: true, reason: 'Expectation passed' };
}

function createHumanSummary(summary) {
  const lines = [];
  lines.push('UX Runner Summary');
  lines.push(`Run ID: ${summary.runId}`);
  lines.push(`Scenario: ${summary.scenarioId}`);
  lines.push(`Profile: ${summary.profileId}`);
  lines.push(`Effective mode: ${summary.effectiveMode}`);
  lines.push(`Started: ${summary.startedAt}`);
  lines.push(`Finished: ${summary.finishedAt}`);
  lines.push(`Total steps: ${summary.totalSteps}`);
  lines.push(`Skipped from checkpoint: ${summary.skippedFromCheckpoint || 0}`);
  lines.push(`Executed this run: ${summary.executedSteps || summary.totalSteps}`);
  lines.push(`Passed: ${summary.passed}`);
  lines.push(`Failed: ${summary.failed}`);
  lines.push('');
  lines.push('Step Results:');
  for (const s of summary.steps) {
    lines.push(`- [${s.status.toUpperCase()}] ${s.index + 1}. ${s.id} (${s.tool})`);
    if (s.reason) lines.push(`  reason: ${s.reason}`);
  }
  return lines.join('\n') + '\n';
}

async function runUxRunner(config) {
  const runnerRoot = config.runnerRoot;
  const rootDir = path.resolve(runnerRoot, '..', '..');

  const manifest = safeReadJson(path.join(runnerRoot, 'manifest.json'));
  if (!manifest) throw new Error('Missing ux-runner manifest.json');

  const scenarioId = config.scenario || manifest.defaults.scenario;
  const profileId = config.profile || manifest.defaults.profile;

  const scenarioPath = path.join(runnerRoot, 'scenarios', `${scenarioId}.json`);
  const profilePath = path.join(runnerRoot, 'profiles', `${profileId}.json`);

  const scenario = safeReadJson(scenarioPath);
  const profile = safeReadJson(profilePath);

  if (!scenario) throw new Error(`Scenario not found: ${scenarioPath}`);
  if (!profile) throw new Error(`Profile not found: ${profilePath}`);

  validateScenario(scenario);
  validateProfile(profile);

  const visibleOverride = !!config.visible;
  if (visibleOverride) {
    profile.executionProfile.mode = 'visible';
    profile.executionProfile.announceActions = true;
  }

  const runId = `${timestamp()}_${scenario.id}`;
  const paths = buildPaths(runnerRoot, scenario.id, runId);

  ensureDir(paths.artifactsRoot);
  ensureDir(paths.stepsRoot);
  ensureDir(paths.reportsRoot);

  const checkpoint = config.resume ? safeReadJson(paths.stateFile, null) : null;
  const startIndex = checkpoint && checkpoint.scenarioId === scenario.id ? checkpoint.nextStepIndex : 0;
  const stopAfter = Number.isInteger(config.stopAfter) ? config.stopAfter : null;

  const client = new McpClient(path.join(rootDir, 'mcp-server.js'));
  await client.start();

  const startedAt = nowIso();
  const stepResults = [];
  let previousImageStats = null;

  try {
    const tools = await client.listTools();
    const available = new Set(tools.map((t) => t.name));

    writeJson(path.join(paths.reportsRoot, 'capability_registry.json'), {
      generatedAt: nowIso(),
      toolCount: tools.length,
      tools: tools.map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || {} })),
    });

    for (const requiredTool of scenario.requiredTools) {
      if (!available.has(requiredTool)) {
        throw new Error(`Missing required tool for scenario ${scenario.id}: ${requiredTool}`);
      }
    }

    if (profile.runner && profile.runner.normalizeControlState !== false) {
      await normalizeControlState(client);
    }

    if (profile.runner && profile.runner.requestControlBeforeRun !== false) {
      await client.callTool('request_control');
    }

    await client.callTool('set_execution_profile', profile.executionProfile || { mode: 'quiet' });

    writeJson(paths.runMetaFile, {
      runId,
      startedAt,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      profileId: profile.id,
      effectiveMode: profile.executionProfile.mode,
      visibleOverride,
      startIndex,
      toolsDiscovered: tools.length,
      requiredTools: scenario.requiredTools,
      tags: scenario.tags || [],
      resumedFromCheckpoint: !!checkpoint,
    });

    for (let i = startIndex; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const gate = enforceRiskPolicy(step, profile, config);
      if (!gate.allowed) {
        const gateError = `${gate.reason} [step=${step.id}, tool=${step.tool}, risk=${gate.risk}]`;
        writeJson(paths.stateFile, {
          scenarioId: scenario.id,
          runId,
          nextStepIndex: i,
          updatedAt: nowIso(),
          completed: false,
          lastError: gateError,
        });
        throw new Error(gateError);
      }

      const stepDir = path.join(paths.stepsRoot, stepFolderName(i, step.id));
      ensureDir(stepDir);

      const request = {
        index: i,
        id: step.id,
        tool: step.tool,
        args: step.args || {},
        risk: gate.risk,
        gateReason: gate.reason,
        startedAt: nowIso(),
      };

      let rawResult;
      let evalResult;

      try {
        rawResult = await client.callTool(step.tool, step.args || {});
        const result = normalizeRunResult(rawResult);
        evalResult = evaluateExpectation(step, result);

        if (!evalResult.pass) {
          throw new Error(evalResult.reason);
        }

        const captureEnabled =
          step.captureScreenshot ||
          scenario.captureAfterEachStep ||
          (profile.runner && profile.runner.captureAfterEachStep);

        if (captureEnabled) {
          const shot = await client.callTool('take_screenshot', {});
          if (shot.ok && shot.image && shot.image.data) {
            const imagePath = path.join(stepDir, 'screen.png');
            writePngBase64(imagePath, shot.image.data);

            const stats = imageStats(shot.image.data);
            const enableDiff =
              step.diffWithPreviousScreenshot === true ||
              (profile.runner && profile.runner.enableScreenshotDiff === true);
            const diff = enableDiff ? diffStats(previousImageStats, stats) : null;
            previousImageStats = stats;

            writeJson(path.join(stepDir, 'screenshot_meta.json'), {
              imagePath,
              stats,
              diffFromPrevious: diff,
            });
          }
        }

        const success = {
          index: i,
          id: step.id,
          tool: step.tool,
          status: 'pass',
          reason: evalResult.reason,
          completedAt: nowIso(),
        };
        stepResults.push(success);

        writeJson(path.join(stepDir, 'request.json'), request);
        writeJson(path.join(stepDir, 'response.json'), rawResult);
        writeJson(path.join(stepDir, 'evaluation.json'), evalResult);

        writeJson(paths.stateFile, {
          scenarioId: scenario.id,
          runId,
          nextStepIndex: i + 1,
          updatedAt: nowIso(),
          completed: false,
        });
      } catch (err) {
        const failure = {
          index: i,
          id: step.id,
          tool: step.tool,
          status: 'fail',
          reason: err.message,
          completedAt: nowIso(),
        };
        stepResults.push(failure);

        writeJson(path.join(stepDir, 'request.json'), request);
        writeJson(path.join(stepDir, 'response.json'), rawResult || { ok: false, error: err.message });
        writeJson(path.join(stepDir, 'evaluation.json'), evalResult || { pass: false, reason: err.message });

        writeJson(paths.stateFile, {
          scenarioId: scenario.id,
          runId,
          nextStepIndex: i,
          updatedAt: nowIso(),
          completed: false,
          lastError: err.message,
        });

        throw err;
      }

      if (stopAfter != null && i + 1 >= stopAfter) {
        writeJson(paths.stateFile, {
          scenarioId: scenario.id,
          runId,
          nextStepIndex: i + 1,
          updatedAt: nowIso(),
          completed: false,
          interrupted: true,
          interruptReason: `Stopped intentionally after ${stopAfter} step(s)`,
        });
        throw new Error(`Intentional stop after ${stopAfter} step(s). Resume with --resume.`);
      }
    }

    writeJson(paths.stateFile, {
      scenarioId: scenario.id,
      runId,
      nextStepIndex: scenario.steps.length,
      updatedAt: nowIso(),
      completed: true,
    });
  } finally {
    try {
      if (profile.runner && profile.runner.releaseControlAfterRun !== false) {
        await client.callTool('release_control');
      }
      await client.callTool('set_execution_profile', { mode: 'quiet' });
    } catch {
      // Best effort cleanup.
    }
    await client.stop();
  }

  const finishedAt = nowIso();
  const passed = stepResults.filter((s) => s.status === 'pass').length;
  const failed = stepResults.filter((s) => s.status === 'fail').length;

  const summary = {
    runId,
    scenarioId: scenario.id,
    profileId: profile.id,
    effectiveMode: profile.executionProfile.mode,
    visibleOverride,
    startedAt,
    finishedAt,
    totalSteps: scenario.steps.length,
    skippedFromCheckpoint: startIndex,
    executedSteps: stepResults.length,
    passed,
    failed,
    steps: stepResults,
  };

  writeJson(paths.runSummaryFile, summary);
  writeJson(paths.latestAiFile, summary);
  writeText(paths.runHumanFile, createHumanSummary(summary));
  writeText(paths.latestHumanFile, createHumanSummary(summary));

  return summary;
}

module.exports = {
  parseArgs,
  runUxRunner,
};
