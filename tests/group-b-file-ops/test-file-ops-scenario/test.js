'use strict';

const path = require('path');
const fs   = require('fs');
const { assert, assertHasKeys } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    const scenariosDir = path.join(__dirname, '../../ux-runner/scenarios');

    // Test 1: file-ops-demo.json exists and is valid JSON
    const demoPath = path.join(scenariosDir, 'file-ops-demo.json');
    assert(fs.existsSync(demoPath), 'file-ops-demo.json should exist');
    let scenario;
    try {
      scenario = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
    } catch (err) {
      throw new Error(`file-ops-demo.json is not valid JSON: ${err.message}`);
    }
    assertHasKeys(scenario, ['id', 'title', 'steps', 'requiredTools'], 'scenario');
    assert(scenario.steps.length >= 3, 'scenario should have >= 3 steps');

    // Test 2: catalog.json includes file-ops-demo
    const catalogPath = path.join(scenariosDir, 'catalog.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const ids = catalog.scenarios.map(s => s.id);
    assert(ids.includes('file-ops-demo'), 'catalog should include file-ops-demo');

    // Test 3: all scenario ids in catalog have matching .json files
    for (const entry of catalog.scenarios) {
      const p = path.join(scenariosDir, entry.path.replace(/^scenarios\//, ''));
      assert(fs.existsSync(p), `catalog entry "${entry.id}" missing file: ${entry.path}`);
    }

    // Test 4: write_file + read_file live round-trip via MCP
    const os = require('os');
    const tmpPath = path.join(os.tmpdir(), `os-bridge-roundtrip-${Date.now()}.txt`);
    const content = 'file-ops-demo test round-trip';

    const w = await client.callTool('write_file', { filePath: tmpPath, content });
    assert(w.ok, `write_file failed: ${w.error}`);

    const r = await client.callTool('read_file', { filePath: tmpPath });
    assert(r.ok, `read_file failed: ${r.error}`);
    assert(r.json.content === content, 'round-trip content mismatch');

    const l = await client.callTool('list_directory', {
      dirPath: require('os').tmpdir(),
      filter: '.txt',
      maxEntries: 100,
    });
    assert(l.ok, `list_directory failed: ${l.error}`);

    try { fs.unlinkSync(tmpPath); } catch {}

    return {
      notes: 'file-ops-demo: scenario valid, catalog updated, MCP round-trip write→read→list all pass',
      details: { scenarioSteps: scenario.steps.length, catalogCount: catalog.scenarios.length },
    };
  },
};
