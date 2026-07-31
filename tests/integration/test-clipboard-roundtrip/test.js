'use strict';

const { assert } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    const token = `reflex-roundtrip-${Date.now()}`;

    const write = await client.callTool('write_clipboard', { text: token });
    assert(write.ok, `write_clipboard failed: ${write.error}`);

    const read = await client.callTool('read_clipboard');
    assert(read.ok, `read_clipboard failed: ${read.error}`);
    assert(read.json && typeof read.json === 'object', 'Expected read_clipboard JSON output');
    assert(read.json.text === token, `Clipboard mismatch. Expected ${token}, got ${read.json.text}`);

    return {
      notes: 'Clipboard roundtrip succeeded',
      details: { tokenLength: token.length },
    };
  },
};
