'use strict';
// Wave 5 — MCP Prompts protocol tests

module.exports = {
  async run({ client }) {
    const notes = [];

    // prompts/list
    const listResult = await client.request('prompts/list', {});
    const prompts = listResult.prompts || [];
    assert(Array.isArray(prompts), 'prompts/list should return an array');
    assert(prompts.length >= 5, `Expected at least 5 prompts, got ${prompts.length}`);
    const names = prompts.map(p => p.name);
    for (const expected of ['automate_app', 'find_memory_hogs', 'monitor_file', 'debug_slow_startup', 'capture_window_state']) {
      assert(names.includes(expected), `Missing prompt: ${expected}`);
    }
    // Each prompt should have name + description
    for (const p of prompts) {
      assert(typeof p.name === 'string' && p.name.length > 0, `Prompt missing name`);
      assert(typeof p.description === 'string' && p.description.length > 0, `Prompt ${p.name} missing description`);
    }
    notes.push(`prompts/list: ${prompts.length} prompts found`);

    // prompts/get — automate_app
    const getResult = await client.request('prompts/get', {
      name: 'automate_app',
      arguments: { appName: 'Notepad', goal: 'type Hello World' },
    });
    assert(Array.isArray(getResult.messages), 'prompts/get should return messages array');
    assert(getResult.messages.length > 0, 'messages should not be empty');
    const msg = getResult.messages[0];
    assert(msg.role === 'user', 'message role should be user');
    assert(msg.content && msg.content.type === 'text', 'message content should be text');
    assert(msg.content.text.includes('Notepad'), 'message text should mention appName');
    assert(msg.content.text.includes('type Hello World'), 'message text should mention goal');
    notes.push('prompts/get automate_app: correct structure and interpolation');

    // prompts/get — find_memory_hogs (no args)
    const memResult = await client.request('prompts/get', { name: 'find_memory_hogs', arguments: {} });
    assert(Array.isArray(memResult.messages) && memResult.messages.length > 0, 'find_memory_hogs should return messages');
    assert(memResult.messages[0].content.text.includes('get_processes'), 'should reference get_processes tool');
    notes.push('prompts/get find_memory_hogs: returned workflow message');

    // prompts/get — monitor_file
    const monResult = await client.request('prompts/get', {
      name: 'monitor_file',
      arguments: { filePath: 'C:\\test.log', intervalSecs: '30' },
    });
    assert(Array.isArray(monResult.messages) && monResult.messages.length > 0, 'monitor_file should return messages');
    assert(monResult.messages[0].content.text.includes('C:\\test.log'), 'should interpolate filePath');
    notes.push('prompts/get monitor_file: filePath interpolated correctly');

    // prompts/get — unknown prompt should return error (not crash)
    let errOccurred = false;
    try {
      await client.request('prompts/get', { name: 'nonexistent_prompt_xyz', arguments: {} });
    } catch (e) {
      errOccurred = true;
    }
    assert(errOccurred, 'prompts/get should error for unknown prompt');
    notes.push('prompts/get unknown: error correctly returned');

    return { notes: notes.join('; ') };
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
