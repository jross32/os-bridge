'use strict';

const { assert, assertHasKeys } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    // First, discover available windows
    const listResp = await client.callTool('list_windows');
    assert(listResp.ok, `list_windows failed: ${listResp.error}`);
    const windows = Array.isArray(listResp.json) ? listResp.json : [];

    // Test 1: fallback (no matching pid) — should return full-screen image + warning
    // screenshot_window returns an image result; the MCP client surfaces it as result.image
    // The warning field comes back as a separate text content item or embedded; check both paths.
    const fallbackResp = await client.callTool('screenshot_window', { pid: -999999 }, 30000);
    assert(fallbackResp.ok, `screenshot_window fallback failed: ${fallbackResp.error}`);
    // Image results surface under result.image (type='image') OR under result.json if the tool
    // returned JSON. Check both paths.
    const fbImg = fallbackResp.image || fallbackResp.json;
    assert(fbImg && fbImg.data, 'Fallback should return image data');
    assert(typeof fbImg.data === 'string' && fbImg.data.length > 100, 'Fallback image data should be a non-trivial base64 string');
    assert(fbImg.mimeType === 'image/png', 'Fallback should be image/png');

    if (windows.length === 0) {
      return { notes: 'No visible windows — fallback test passed, window-crop test skipped', details: { windowCount: 0 } };
    }

    // Test 2: screenshot a real window by PID (stable; avoids title races)
    const win = windows[0];
    const imgResp = await client.callTool('screenshot_window', { pid: win.pid }, 30000);
    assert(imgResp.ok, `screenshot_window failed for '${win.title}': ${imgResp.error}`);
    const img = imgResp.image || imgResp.json;
    assert(img && img.data, 'Should return image data');
    assert(img.mimeType === 'image/png', 'mimeType should be image/png');
    assert(typeof img.data === 'string' && img.data.length > 500, 'Image data should be substantial');

    return {
      notes: 'screenshot_window: fallback + real window capture both pass',
      details: {
        windowCaptured: win.title.slice(0, 40),
        imageSizeKB: Math.round(img.data.length * 0.75 / 1024),
      },
    };
  },
};
