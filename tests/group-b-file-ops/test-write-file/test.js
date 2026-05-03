'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { assert } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    const tmpPath = path.join(os.tmpdir(), `os-bridge-write-test-${Date.now()}.txt`);

    try {
      // Write new file
      const writeResp = await client.callTool('write_file', {
        filePath: tmpPath,
        content: 'first line\n',
      });
      assert(writeResp.ok, `write_file failed: ${writeResp.error}`);
      assert(writeResp.json.written === true, 'written flag should be true');
      assert(writeResp.json.sizeBytes > 0, 'sizeBytes should be > 0');

      // Append to file
      const appendResp = await client.callTool('write_file', {
        filePath: tmpPath,
        content: 'second line\n',
        append: true,
      });
      assert(appendResp.ok, `write_file append failed: ${appendResp.error}`);

      // Verify content via read_file
      const readResp = await client.callTool('read_file', { filePath: tmpPath });
      assert(readResp.ok, `read_file after write failed: ${readResp.error}`);
      assert(readResp.json.content.includes('first line'), 'should include first line');
      assert(readResp.json.content.includes('second line'), 'should include second line');

      return {
        notes: 'write_file created and appended correctly; verified via read_file',
        details: { finalSize: readResp.json.sizeBytes },
      };
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  },
};
