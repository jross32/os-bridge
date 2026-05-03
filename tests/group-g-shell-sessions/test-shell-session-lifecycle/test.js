'use strict';

const { assert, assertHasKeys } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    // ── Open a PowerShell session ───────────────────────────────────────────
    const openResp = await client.callTool('shell_open', { shell: 'powershell' });
    assert(openResp.ok, `shell_open failed: ${openResp.error}`);
    assertHasKeys(openResp.json, ['sessionId', 'shell', 'pid'], 'shell_open response');
    assert(typeof openResp.json.sessionId === 'string' && openResp.json.sessionId.length > 0, 'sessionId should be non-empty');
    assert(typeof openResp.json.pid === 'number' && openResp.json.pid > 0, 'pid should be positive');
    const { sessionId } = openResp.json;

    try {
      // ── shell_list_sessions should show 1 session ───────────────────────
      const listResp = await client.callTool('shell_list_sessions');
      assert(listResp.ok, `shell_list_sessions failed: ${listResp.error}`);
      assertHasKeys(listResp.json, ['count', 'sessions'], 'list response');
      assert(listResp.json.count >= 1, 'Expected at least 1 open session');
      const found = listResp.json.sessions.some(s => s.sessionId === sessionId);
      assert(found, 'New session should appear in shell_list_sessions');

      // ── Send a command and get output ────────────────────────────────────
      const sendResp = await client.callTool('shell_send', {
        sessionId,
        command: 'Write-Output "hello-from-mcp"',
        timeoutMs: 6000,
      });
      assert(sendResp.ok, `shell_send failed: ${sendResp.error}`);
      assertHasKeys(sendResp.json, ['stdout', 'stderr'], 'shell_send response');
      assert(sendResp.json.stdout.includes('hello-from-mcp'), `Expected 'hello-from-mcp' in stdout, got: ${sendResp.json.stdout.slice(0, 200)}`);

      // ── Send a second command (cwd check) ───────────────────────────────
      const cwdResp = await client.callTool('shell_send', {
        sessionId,
        command: '(Get-Location).Path',
        timeoutMs: 6000,
      });
      assert(cwdResp.ok, `shell_send (cwd) failed: ${cwdResp.error}`);
      assert(cwdResp.json.stdout.trim().length > 0, 'cwd output should be non-empty');

      // ── shell_read should return buffered output ─────────────────────────
      // (buffer may or may not have content depending on timing — just check shape)
      const readResp = await client.callTool('shell_read', { sessionId, clear: false });
      assert(readResp.ok, `shell_read failed: ${readResp.error}`);
      assertHasKeys(readResp.json, ['stdout', 'stderr', 'closed'], 'shell_read response');
      assert(readResp.json.closed === false, 'Session should still be open');

      // ── Error: unknown session ───────────────────────────────────────────
      const badResp = await client.callTool('shell_send', { sessionId: 'no-such-session-id', command: 'echo hi' });
      assert(!badResp.ok, 'shell_send with unknown sessionId should fail');

    } finally {
      // ── Close the session ────────────────────────────────────────────────
      const closeResp = await client.callTool('shell_close', { sessionId });
      assert(closeResp.ok, `shell_close failed: ${closeResp.error}`);
      assert(closeResp.json.closed === true, 'close response should have closed=true');
    }

    return {
      notes: 'shell_open / shell_send / shell_read / shell_list_sessions / shell_close all pass',
      details: { sessionId: sessionId.slice(0, 8) + '…' },
    };
  },
};
