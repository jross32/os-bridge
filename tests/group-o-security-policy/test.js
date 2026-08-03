'use strict';

const path = require('path');
const { McpClient } = require('../lib/mcp-client');
const { assert } = require('../lib/assertions');

module.exports = {
  async run({ rootDir }) {
    const client = new McpClient(path.join(rootDir, 'mcp-server.js'), {
      env: { REFLEX_SECURITY_MODE: 'guarded' },
    });
    await client.start();
    try {
      const policy = await client.callTool('get_security_policy');
      assert(policy.ok === true, 'get_security_policy should succeed');
      assert(policy.json.mode === 'guarded', 'default-policy server should be guarded');
      assert(Array.isArray(policy.json.highRiskTools) && policy.json.highRiskTools.includes('run_command'),
        'run_command must be classified as high risk');

      const blocked = await client.callTool('run_command', { command: 'Write-Output should-not-run' });
      assert(blocked.ok === false, 'guarded mode must block command execution');
      assert(blocked.errorInfo && blocked.errorInfo.code === 'approval_required',
        'guarded command block should return approval_required');

      return { notes: 'guarded policy exposed and high-risk command blocked before execution', details: { checks: 4 } };
    } finally {
      await client.stop();
    }
  },
};
