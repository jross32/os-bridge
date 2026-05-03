'use strict';

const { assert, assertHasKeys } = require('../../lib/assertions');

module.exports = {
  async run({ client, includeDangerous }) {
    if (!includeDangerous) {
      return { notes: 'Skipped implicitly by runner filtering' };
    }

    const result = await client.callTool('run_command', { command: 'Write-Output "os-bridge-test"' });
    assert(result.ok, `Expected success, got error: ${result.error}`);
    assert(result.json && typeof result.json === 'object', 'Expected JSON output');
    assertHasKeys(result.json, ['stdout', 'stderr', 'exitCode', 'timedOut'], 'run_command result');
    assert(String(result.json.stdout).includes('os-bridge-test'), 'Expected echoed stdout text');

    return {
      notes: 'run_command envelope verified with safe command',
    };
  },
};
