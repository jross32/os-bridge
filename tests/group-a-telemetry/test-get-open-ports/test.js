'use strict';

const { assert } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    const result = await client.callTool('get_open_ports');
    assert(result.ok, `Expected success, got error: ${result.error}`);
    assert(Array.isArray(result.json), 'Expected array output');

    if (result.json.length > 0) {
      const first = result.json[0];
      assert(typeof first.port === 'number', 'Expected numeric port');
      assert(typeof first.pid === 'number', 'Expected numeric pid');
      assert(Object.prototype.hasOwnProperty.call(first, 'process'), 'Expected process field');
    }

    return {
      notes: 'Open ports shape verified',
      details: { count: result.json.length },
    };
  },
};
