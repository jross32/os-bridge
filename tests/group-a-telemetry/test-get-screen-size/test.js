'use strict';

const { assert, assertHasKeys } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    const result = await client.callTool('get_screen_size');
    assert(result.ok, `Expected success, got error: ${result.error}`);
    assert(result.json && typeof result.json === 'object', 'Expected object output');
    assertHasKeys(result.json, ['width', 'height', 'allScreens'], 'screenSize');
    assert(Array.isArray(result.json.allScreens), 'Expected allScreens array');
    assert(result.json.width > 0 && result.json.height > 0, 'Expected positive primary dimensions');

    return {
      notes: 'Screen metrics shape validated',
      details: { monitors: result.json.allScreens.length },
    };
  },
};
