'use strict';

const { assert, assertHasKeys } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    // Test 1: get all env vars
    const allResp = await client.callTool('get_environment_vars', {});
    assert(allResp.ok, `get_environment_vars (all) failed: ${allResp.error}`);
    assertHasKeys(allResp.json, ['count', 'vars', 'filtered'], 'env response');
    assert(allResp.json.count > 0, 'should have at least some env vars');
    assert(allResp.json.filtered === false, 'all-mode should not be filtered');

    // Test 2: filter by prefix (PATH-related)
    const prefixResp = await client.callTool('get_environment_vars', { prefix: 'PATH' });
    assert(prefixResp.ok, `get_environment_vars (prefix) failed: ${prefixResp.error}`);
    assert(prefixResp.json.filtered === true, 'should be marked filtered');
    for (const key of Object.keys(prefixResp.json.vars)) {
      assert(key.toUpperCase().startsWith('PATH'), `unexpected key not starting with PATH: ${key}`);
    }

    // Test 3: specific names
    const namesResp = await client.callTool('get_environment_vars', { names: ['PATH', 'COMPUTERNAME'] });
    assert(namesResp.ok, `get_environment_vars (names) failed: ${namesResp.error}`);
    assert('PATH' in namesResp.json.vars, 'PATH should be present in named result');
    assert('COMPUTERNAME' in namesResp.json.vars, 'COMPUTERNAME should be present');

    return {
      notes: 'get_environment_vars: all-mode, prefix-filter, and named-lookup all work',
      details: { totalVarCount: allResp.json.count },
    };
  },
};
