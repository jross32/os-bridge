'use strict';

const { assert, assertHasKeys, assertErrorContains } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    // First, discover available windows so we can pick a real title
    const listResp = await client.callTool('list_windows');
    assert(listResp.ok, `list_windows failed: ${listResp.error}`);
    const windows = Array.isArray(listResp.json) ? listResp.json : [];

    // Test 1: error on non-existent pid (always testable)
    const badResp = await client.callTool('get_window_rect', { pid: -999999 });
    assert(!badResp.ok, 'get_window_rect should fail for unknown pid');

    if (windows.length === 0) {
      return { notes: 'No visible windows available — error-case test passed, shape test skipped', details: { windowCount: 0 } };
    }

    // Test 2: use real window by PID (stable; avoids title races)
    const win = windows[0];
    const rectResp = await client.callTool('get_window_rect', { pid: win.pid });
    assert(rectResp.ok, `get_window_rect failed for '${win.title}': ${rectResp.error}`);
    assertHasKeys(rectResp.json, ['x', 'y', 'width', 'height', 'pid', 'processName', 'title', 'matchedBy'], 'windowRect');
    assert(typeof rectResp.json.width === 'number', 'width should be a number');
    assert(typeof rectResp.json.height === 'number', 'height should be a number');
    assert(typeof rectResp.json.pid === 'number' && rectResp.json.pid > 0, 'pid should be positive int');
    assert(rectResp.json.matchedBy === 'pid', 'expected pid matching path');

    return {
      notes: 'get_window_rect: error case and shape validation passed',
      details: {
        windowTested: win.title.slice(0, 40),
        rect: { x: rectResp.json.x, y: rectResp.json.y, w: rectResp.json.width, h: rectResp.json.height },
      },
    };
  },
};
