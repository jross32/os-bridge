'use strict';

const { assert } = require('../lib/assertions');

module.exports = {
  async run({ client }) {
    const hotspots = await client.callTool('process_resource_hotspots', { topN: 3 });
    assert(hotspots.ok, `Expected hotspots success, got error: ${hotspots.error}`);
    assert(hotspots.json && Array.isArray(hotspots.json.topCpu), 'Expected topCpu array');
    assert(hotspots.json && Array.isArray(hotspots.json.topMemory), 'Expected topMemory array');
    assert(hotspots.json.topCpu.length <= 3, `Expected <= 3 cpu rows, got ${hotspots.json.topCpu.length}`);
    assert(hotspots.json.topMemory.length <= 3, `Expected <= 3 memory rows, got ${hotspots.json.topMemory.length}`);

    const waitRunning = await client.callTool('wait_for_process_state', {
      name: 'node',
      desiredState: 'running',
      timeoutMs: 2000,
      pollMs: 200,
    });
    assert(waitRunning.ok, `Expected wait_for_process_state success, got error: ${waitRunning.error}`);
    assert(waitRunning.json && waitRunning.json.matched === true, 'Expected process state match for running node process');

    const tree = await client.callTool('process_tree', { processName: 'node', maxNodes: 25 });
    assert(tree.ok, `Expected process_tree success, got error: ${tree.error}`);
    assert(tree.json && Array.isArray(tree.json.nodes), 'Expected process_tree nodes array');
    assert(tree.json && tree.json.nodes.length > 0, 'Expected non-empty process tree');

    const netMap = await client.callTool('process_network_map', { limit: 25 });
    assert(netMap.ok, `Expected process_network_map success, got error: ${netMap.error}`);
    assert(netMap.json && Array.isArray(netMap.json.summary), 'Expected process_network_map summary array');
    assert(netMap.json && Array.isArray(netMap.json.connections), 'Expected process_network_map connections array');

    return {
      notes: 'Process intelligence tools returned expected structures and wait/process checks passed',
      details: {
        topCpuRows: hotspots.json.topCpu.length,
        treeNodes: tree.json.nodes.length,
        summaryRows: netMap.json.summary.length,
        connectionRows: netMap.json.connections.length,
      },
    };
  },
};
