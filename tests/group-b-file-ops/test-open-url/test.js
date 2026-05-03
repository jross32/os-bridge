'use strict';

const { assert } = require('../../lib/assertions');

module.exports = {
  async run({ client, includeDangerous }) {
    // Always: verify a bad URL is rejected
    const badResp = await client.callTool('open_url', { url: 'ftp://not-allowed.example' });
    assert(!badResp.ok, 'open_url with ftp:// should be rejected');
    assert(
      String(badResp.error || '').toLowerCase().includes('http'),
      `Expected error about http://, got: ${badResp.error}`
    );

    // Missing url
    const missingResp = await client.callTool('open_url', {});
    assert(!missingResp.ok, 'open_url with no url should fail');

    if (!includeDangerous) {
      return {
        notes: 'open_url: bad-URL rejection validated; real launch skipped (pass --dangerous to enable)',
      };
    }

    // Dangerous: actually open a URL
    const okResp = await client.callTool('open_url', { url: 'https://example.com' });
    assert(okResp.ok, `open_url https://example.com failed: ${okResp.error}`);
    assert(okResp.json.opened === true, 'opened flag should be true');

    return { notes: 'open_url: bad-URL rejection + real launch verified', details: { url: 'https://example.com' } };
  },
};
