'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { assert } = require('../lib/assertions');

module.exports = {
  async run({ client }) {
    // ── Setup: create temp files ───────────────────────────────────────────
    const tmpDir  = os.tmpdir();
    const fileA   = path.join(tmpDir, 'osb_test_a.txt');
    const fileB   = path.join(tmpDir, 'osb_test_b.txt');
    const content = Array.from({ length: 30 }, (_, i) => `line ${i + 1}: hello world`).join('\n');
    const modifiedLines = content.split('\n').map((l, i) => i === 14 ? 'line 15: CHANGED' : l).join('\n');
    fs.writeFileSync(fileA, content, 'utf8');
    fs.writeFileSync(fileB, modifiedLines, 'utf8');

    try {
      // ── read_file_lines ────────────────────────────────────────────────
      const lineRead = await client.callTool('read_file_lines', { filePath: fileA, startLine: 3, endLine: 7 });
      assert(lineRead.ok, `read_file_lines failed: ${lineRead.error}`);
      assert(lineRead.json && Array.isArray(lineRead.json.lines), 'Expected lines array');
      assert(lineRead.json.lines.length === 5, `Expected 5 lines, got ${lineRead.json.lines.length}`);
      assert(lineRead.json.startLine === 3, `Expected startLine 3, got ${lineRead.json.startLine}`);
      assert(lineRead.json.lines[0].includes('line 3'), `Expected first line to contain 'line 3'`);

      // ── grep_file ──────────────────────────────────────────────────────
      const grepResult = await client.callTool('grep_file', { filePath: fileA, pattern: 'line 1\\d', ignoreCase: false });
      assert(grepResult.ok, `grep_file failed: ${grepResult.error}`);
      assert(grepResult.json && Array.isArray(grepResult.json.matches), 'Expected matches array');
      assert(grepResult.json.matchCount > 0, 'Expected at least one grep match');
      assert(grepResult.json.matches[0].lineNumber > 0, 'Expected lineNumber > 0');
      assert(typeof grepResult.json.matches[0].line === 'string', 'Expected line string');

      // ── diff_files ─────────────────────────────────────────────────────
      const diffResult = await client.callTool('diff_files', { fileA, fileB });
      assert(diffResult.ok, `diff_files failed: ${diffResult.error}`);
      assert(diffResult.json && !diffResult.json.identical, 'Expected files to differ');
      assert(Array.isArray(diffResult.json.hunks) && diffResult.json.hunks.length > 0, 'Expected at least one diff hunk');
      const hunk = diffResult.json.hunks[0];
      assert(Array.isArray(hunk.removed) && Array.isArray(hunk.added), 'Expected removed and added arrays in hunk');

      // ── diff_files identical ───────────────────────────────────────────
      const diffSame = await client.callTool('diff_files', { fileA, fileB: fileA });
      assert(diffSame.ok, `diff_files (identical) failed: ${diffSame.error}`);
      assert(diffSame.json && diffSame.json.identical === true, 'Expected identical=true for same file diff');

      // ── hash_file ──────────────────────────────────────────────────────
      const hashResult = await client.callTool('hash_file', { filePath: fileA, algorithm: 'sha256' });
      assert(hashResult.ok, `hash_file failed: ${hashResult.error}`);
      assert(hashResult.json && typeof hashResult.json.hash === 'string', 'Expected hash string');
      assert(hashResult.json.hash.length === 64, `Expected 64-char sha256, got ${hashResult.json.hash.length}`);
      assert(hashResult.json.algorithm === 'sha256', `Expected algorithm sha256`);

      const hashMd5 = await client.callTool('hash_file', { filePath: fileA, algorithm: 'md5' });
      assert(hashMd5.ok, `hash_file md5 failed: ${hashMd5.error}`);
      assert(hashMd5.json.hash.length === 32, `Expected 32-char md5, got ${hashMd5.json.hash.length}`);

      // ── watch_file_changes ─────────────────────────────────────────────
      const watchResult = await client.callTool('watch_file_changes', { filePath: fileA });
      assert(watchResult.ok, `watch_file_changes failed: ${watchResult.error}`);
      assert(watchResult.json && watchResult.json.exists === true, 'Expected exists=true');
      assert(typeof watchResult.json.sizeBytes === 'number' && watchResult.json.sizeBytes > 0, 'Expected sizeBytes > 0');
      assert(typeof watchResult.json.mtimeIso === 'string', 'Expected mtimeIso string');

      const watchMissing = await client.callTool('watch_file_changes', { filePath: path.join(tmpDir, 'osb_no_such_file_xyz.txt') });
      assert(watchMissing.ok, `watch_file_changes (missing) failed: ${watchMissing.error}`);
      assert(watchMissing.json && watchMissing.json.exists === false, 'Expected exists=false for missing file');

    } finally {
      try { fs.unlinkSync(fileA); } catch { /* ignore */ }
      try { fs.unlinkSync(fileB); } catch { /* ignore */ }
    }

    return {
      notes: 'File system intelligence tools all returned expected structures',
      details: { testedTools: ['read_file_lines', 'grep_file', 'diff_files', 'hash_file', 'watch_file_changes'] },
    };
  },
};
