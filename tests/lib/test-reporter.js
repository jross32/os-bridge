'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ensureDir, nowIso, writeJson } = require('./test-helpers');

class TestReporter {
  constructor(baseLogsDir) {
    this.baseLogsDir = baseLogsDir;
    this.results = [];
    this.startedAt = Date.now();
  }

  add(result) {
    this.results.push(result);
  }

  finalize(meta = {}) {
    const endedAt = Date.now();
    const passed = this.results.filter((r) => r.status === 'pass').length;
    const failed = this.results.filter((r) => r.status === 'fail').length;
    const skipped = this.results.filter((r) => r.status === 'skip').length;

    return {
      timestamp: nowIso(),
      server: meta.server || {},
      environment: {
        platform: process.platform,
        release: os.release(),
        node: process.version,
      },
      summary: {
        total: this.results.length,
        passed,
        failed,
        skipped,
        durationMs: endedAt - this.startedAt,
      },
      tests: this.results,
    };
  }

  writeArtifacts(payload, runStamp) {
    ensureDir(this.baseLogsDir);

    const latestAi = path.join(this.baseLogsDir, 'latest_ai.json');
    const latestHuman = path.join(this.baseLogsDir, 'latest_human.md');
    const runDir = path.join(this.baseLogsDir, 'runs', runStamp);

    ensureDir(runDir);

    writeJson(latestAi, payload);
    writeJson(path.join(runDir, 'results.json'), payload);

    const md = this._toHumanMarkdown(payload);
    fs.writeFileSync(latestHuman, md);
    fs.writeFileSync(path.join(runDir, 'summary.md'), md);

    return { latestAi, latestHuman, runDir };
  }

  _toHumanMarkdown(payload) {
    const lines = [];
    lines.push('# OS-Bridge Test Run');
    lines.push(`- Timestamp: ${payload.timestamp}`);
    lines.push(`- Node: ${payload.environment.node}`);
    lines.push(`- Platform: ${payload.environment.platform} ${payload.environment.release}`);
    lines.push('');
    lines.push('## Summary');
    lines.push(`- Total: ${payload.summary.total}`);
    lines.push(`- Passed: ${payload.summary.passed}`);
    lines.push(`- Failed: ${payload.summary.failed}`);
    lines.push(`- Skipped: ${payload.summary.skipped}`);
    lines.push(`- Duration (ms): ${payload.summary.durationMs}`);
    lines.push('');
    lines.push('## Tests');

    for (const t of payload.tests) {
      lines.push(`- [${t.status.toUpperCase()}] ${t.id} (${t.durationMs} ms)`);
      if (t.error) lines.push(`  - error: ${t.error}`);
      if (t.notes) lines.push(`  - notes: ${t.notes}`);
    }

    return lines.join('\n') + '\n';
  }
}

module.exports = { TestReporter };
