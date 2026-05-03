'use strict';

const { assert } = require('../lib/assertions');

module.exports = {
  async run({ client }) {
    // list_windows_detailed — should return an array of window objects
    const detailed = await client.callTool('list_windows_detailed', {});
    assert(detailed.ok, `Expected list_windows_detailed success, got error: ${detailed.error}`);
    const wins = Array.isArray(detailed.json) ? detailed.json : [detailed.json];
    assert(wins.length > 0, 'Expected at least one visible window');
    const first = wins[0];
    assert(typeof first.title === 'string', 'Expected window title string');
    assert(typeof first.pid === 'number', 'Expected window pid number');
    assert(typeof first.x === 'number', 'Expected window x number');
    assert(typeof first.width === 'number', 'Expected window width number');
    assert(['normal', 'minimized', 'maximized'].includes(first.state), `Unexpected state: ${first.state}`);

    // get_focused_app_state — should return the currently focused window
    const focused = await client.callTool('get_focused_app_state', {});
    assert(focused.ok, `Expected get_focused_app_state success, got error: ${focused.error}`);
    assert(focused.json && typeof focused.json.title === 'string', 'Expected focused app title');
    assert(focused.json && typeof focused.json.pid === 'number', 'Expected focused app pid');
    assert(focused.json && typeof focused.json.width === 'number', 'Expected focused app width');
    assert(focused.json && ['normal', 'minimized', 'maximized'].includes(focused.json.state),
      `Unexpected focused state: ${focused.json && focused.json.state}`);

    // window_hierarchy — should return array of top-level windows
    const hier = await client.callTool('window_hierarchy', {});
    assert(hier.ok, `Expected window_hierarchy success, got error: ${hier.error}`);
    const nodes = Array.isArray(hier.json) ? hier.json : [hier.json];
    assert(nodes.length > 0, 'Expected at least one node in window_hierarchy');
    const node = nodes[0];
    assert(typeof node.hwnd === 'string', 'Expected hwnd string');
    assert(typeof node.title === 'string', 'Expected title string');
    assert(typeof node.class === 'string', 'Expected class string');
    assert(typeof node.pid === 'number', 'Expected pid number');

    return {
      notes: 'Window intelligence tools returned expected structures',
      details: {
        visibleWindows: wins.length,
        focusedTitle: focused.json.title,
        hierarchyNodes: nodes.length,
      },
    };
  },
};
