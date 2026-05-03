'use strict';

const { assert, assertHasKeys } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    const result = await client.callTool('get_system_info');
    assert(result.ok, `Expected success, got error: ${result.error}`);
    assert(result.json && typeof result.json === 'object', 'Expected JSON object output');

    assertHasKeys(result.json, [
      'cpu',
      'memory',
      'disks',
      'hostname',
      'username',
      'os',
      'osVersion',
    ], 'systemInfo');

    return {
      notes: 'System info keys present',
      details: {
        hostname: result.json.hostname,
        os: result.json.os,
      },
    };
  },
};
