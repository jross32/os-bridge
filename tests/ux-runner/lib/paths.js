'use strict';

const path = require('path');

function timestamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}${mi}${ss}`;
}

function stepFolderName(index, stepId) {
  const n = String(index + 1).padStart(3, '0');
  return `${n}-${stepId}`;
}

function buildPaths(runnerRoot, scenarioId, runId) {
  const artifactsRoot = path.join(runnerRoot, 'artifacts', 'runs', runId);
  const stepsRoot = path.join(artifactsRoot, 'steps');
  const reportsRoot = path.join(runnerRoot, 'reports');
  const stateFile = path.join(runnerRoot, 'state', `${scenarioId}.checkpoint.json`);

  return {
    artifactsRoot,
    stepsRoot,
    reportsRoot,
    stateFile,
    runMetaFile: path.join(artifactsRoot, 'run_meta.json'),
    runSummaryFile: path.join(artifactsRoot, 'run_summary.json'),
    runHumanFile: path.join(artifactsRoot, 'run_human.txt'),
    latestAiFile: path.join(reportsRoot, 'latest_ai.json'),
    latestHumanFile: path.join(reportsRoot, 'latest_human.txt'),
  };
}

module.exports = {
  timestamp,
  stepFolderName,
  buildPaths,
};
