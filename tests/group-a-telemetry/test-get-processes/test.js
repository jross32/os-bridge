'use strict';

const { assert } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    const result = await client.callTool('get_processes', { limit: 5, sortBy: 'memory' });
    assert(result.ok, `Expected success, got error: ${result.error}`);
    assert(result.json && Array.isArray(result.json.processes), 'Expected processes array output');
    assert(result.json.processes.length > 0, 'Expected at least one process');
    assert(result.json.processes.length <= 5, `Expected <= 5 processes, got ${result.json.processes.length}`);

    const first = result.json.processes[0];
    assert(typeof first.ProcessName === 'string', 'Expected ProcessName on process row');
    assert(typeof first.Id === 'number', 'Expected Id on process row');

    return {
      notes: 'Process query respected limit and row shape',
      details: { rows: result.json.processes.length },
    };
  },
};
