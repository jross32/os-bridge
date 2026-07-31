'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { assert } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    // Write a temp file to read back
    const tmpPath = path.join(os.tmpdir(), `reflex-read-test-${Date.now()}.txt`);
    const expected = 'hello from reflex read_file test\nline 2';
    fs.writeFileSync(tmpPath, expected, 'utf8');

    try {
      const result = await client.callTool('read_file', { filePath: tmpPath });
      assert(result.ok, `read_file failed: ${result.error}`);
      assert(result.json.content === expected, `content mismatch: expected '${expected}' got '${result.json.content}'`);
      assert(result.json.truncated === false, 'should not be truncated');
      assert(result.json.sizeBytes > 0, 'sizeBytes should be > 0');
      return { notes: 'read_file returned correct content', details: { path: tmpPath } };
    } finally {
      fs.unlinkSync(tmpPath);
    }
  },
};
