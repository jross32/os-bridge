'use strict';

const path = require('path');
const { parseArgs, runUxRunner } = require('./lib/ux-runner');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runnerRoot = __dirname;

  const summary = await runUxRunner({
    runnerRoot,
    scenario: args.scenario,
    profile: args.profile,
    visible: args.visible,
    resume: args.resume,
    stopAfter: args.stopAfter,
    approveHighRisk: args.approveHighRisk,
    approveCriticalRisk: args.approveCriticalRisk,
  });

  process.stdout.write('\nUX runner complete.\n');
  process.stdout.write(`- Run ID: ${summary.runId}\n`);
  process.stdout.write(`- Scenario: ${summary.scenarioId}\n`);
  process.stdout.write(`- Profile: ${summary.profileId}\n`);
  process.stdout.write(`- Skipped from checkpoint: ${summary.skippedFromCheckpoint || 0}\n`);
  process.stdout.write(`- Executed this run: ${summary.executedSteps || summary.totalSteps}\n`);
  process.stdout.write(`- Passed: ${summary.passed}\n`);
  process.stdout.write(`- Failed: ${summary.failed}\n\n`);

  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`UX runner failed: ${err.message}\n`);
  process.exit(1);
});
