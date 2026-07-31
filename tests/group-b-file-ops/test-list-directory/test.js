'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const { assert, assertHasKeys } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    // Create a temp dir with some files to list
    const tmpDir = path.join(os.tmpdir(), `reflex-list-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'alpha.txt'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'beta.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, 'subdir'));
    fs.writeFileSync(path.join(tmpDir, 'subdir', 'gamma.txt'), 'g');

    try {
      // Test 1: list all
      const listResp = await client.callTool('list_directory', { dirPath: tmpDir });
      assert(listResp.ok, `list_directory failed: ${listResp.error}`);
      assertHasKeys(listResp.json, ['count', 'entries', 'dirPath'], 'list response');
      assert(listResp.json.count >= 3, `expected >= 3 entries, got ${listResp.json.count}`);

      // Test 2: filter by .txt
      const filtResp = await client.callTool('list_directory', { dirPath: tmpDir, filter: '.txt' });
      assert(filtResp.ok, `list_directory (filter) failed: ${filtResp.error}`);
      for (const e of filtResp.json.entries) {
        if (e.type === 'file') {
          assert(e.name.endsWith('.txt'), `expected .txt file, got: ${e.name}`);
        }
      }

      // Test 3: recursive
      const recResp = await client.callTool('list_directory', { dirPath: tmpDir, recursive: true });
      assert(recResp.ok, `list_directory (recursive) failed: ${recResp.error}`);
      const hasGamma = recResp.json.entries.some(e => e.name === 'gamma.txt');
      assert(hasGamma, 'recursive listing should include gamma.txt in subdir');

      // Test 4: error on non-existent path
      const badResp = await client.callTool('list_directory', { dirPath: path.join(tmpDir, 'no-such') });
      assert(!badResp.ok, 'list_directory should fail for non-existent path');

      return {
        notes: 'list_directory: flat list, filter, recursive, and error case all pass',
        details: { count: listResp.json.count, recursiveCount: recResp.json.count },
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },
};
