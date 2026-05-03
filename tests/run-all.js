'use strict';

const fs = require('fs');
const path = require('path');
const { McpClient } = require('./lib/mcp-client');
const { TestReporter } = require('./lib/test-reporter');
const {
  ensureDir,
  getRunStamp,
  normalizeControlState,
  nowIso,
  walkTests,
} = require('./lib/test-helpers');

async function runOne(testFile, context) {
  const testMod = require(testFile);
  if (!testMod || typeof testMod.run !== 'function') {
    return {
      id: path.relative(context.testsRoot, testFile),
      status: 'skip',
      durationMs: 0,
      notes: 'Missing exported run(context) function',
    };
  }

  const id = path.relative(context.testsRoot, path.dirname(testFile)).replace(/\\/g, '/');
  const started = Date.now();

  try {
    const out = await testMod.run(context);
    const durationMs = Date.now() - started;
    const result = {
      id,
      status: 'pass',
      durationMs,
      notes: out && out.notes ? out.notes : null,
      details: out && out.details ? out.details : null,
    };
    writePerTestArtifact(testFile, result, context);
    return result;
  } catch (err) {
    const result = {
      id,
      status: 'fail',
      durationMs: Date.now() - started,
      error: err.message,
    };
    writePerTestArtifact(testFile, result, context);
    return result;
  }
}

function writePerTestArtifact(testFile, result, context) {
  const outPath = path.join(path.dirname(testFile), 'last_result.json');
  const payload = {
    timestamp: nowIso(),
    runStamp: context.runStamp,
    includeDangerous: context.includeDangerous,
    testFile: path.relative(context.testsRoot, testFile).replace(/\\/g, '/'),
    ...result,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const includeDangerous = args.includes('--dangerous');

  const rootDir = path.resolve(__dirname, '..');
  const testsRoot = __dirname;
  const logsDir = path.join(__dirname, 'logs');

  ensureDir(logsDir);

  const client = new McpClient(path.join(rootDir, 'mcp-server.js'));
  const reporter = new TestReporter(logsDir);
  const runStamp = getRunStamp();

  await client.start();

  try {
    const tools = await client.listTools();

    const files = walkTests(testsRoot)
      .filter((f) => !f.includes(`${path.sep}lib${path.sep}`));

    const filtered = includeDangerous
      ? files
      : files.filter((f) => !f.includes(`${path.sep}group-d-dangerous${path.sep}`));

    for (const testFile of filtered) {
      await normalizeControlState(client);
      const result = await runOne(testFile, {
        client,
        testsRoot,
        includeDangerous,
        runStamp,
        rootDir,
      });
      reporter.add(result);
    }

    const payload = reporter.finalize({
      server: {
        script: path.join(rootDir, 'mcp-server.js'),
        toolsDiscovered: tools.length,
        includeDangerous,
      },
    });

    const artifacts = reporter.writeArtifacts(payload, runStamp);

    process.stdout.write(`\nTest run complete.\n`);
    process.stdout.write(`- JSON: ${artifacts.latestAi}\n`);
    process.stdout.write(`- MD:   ${artifacts.latestHuman}\n`);
    process.stdout.write(`- Run:  ${artifacts.runDir}\n\n`);

    if (payload.summary.failed > 0) process.exitCode = 1;
  } finally {
    await client.stop();
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal test runner error: ${err.message}\n`);
  process.exit(1);
});
