'use strict';

const { assert, assertHasKeys } = require('../lib/assertions');

module.exports = {
  async run({ client }) {
    const notes = [];

    // Invalid required args should return structured validation error.
    const missingRequired = await client.request('tools/call', { name: 'write_file', arguments: {} });
    assert(missingRequired.isError === true, 'write_file missing args should be an error result');
    assert(missingRequired.structuredContent && missingRequired.structuredContent.ok === false,
      'error result should include structuredContent.ok=false');
    assertHasKeys(missingRequired.structuredContent.error,
      ['code', 'category', 'message', 'retryable', 'suggestedAction', 'details'],
      'errorEnvelope');
    assert(missingRequired.structuredContent.error.code === 'invalid_arguments', 'expected invalid_arguments code');
    assert(missingRequired.structuredContent.error.category === 'validation', 'expected validation category');
    assert(Array.isArray(missingRequired.structuredContent.error.details.errors), 'expected validation details.errors array');
    notes.push('write_file required-arg validation envelope passed');

    // Invalid enum should be rejected before tool execution.
    const badEnum = await client.request('tools/call', {
      name: 'get_processes',
      arguments: { sortBy: 'memoryMB' },
    });
    assert(badEnum.isError === true, 'bad enum should produce error result');
    assert(badEnum.structuredContent.error.code === 'invalid_arguments', 'bad enum should map to invalid_arguments');
    notes.push('enum validation check passed');

    // additionalProperties=false should be enforced.
    const badProp = await client.request('tools/call', {
      name: 'get_window_rect',
      arguments: { title: '__none__', bogus: 1 },
    });
    assert(badProp.isError === true, 'additional properties should be rejected');
    assert(badProp.structuredContent.error.code === 'invalid_arguments', 'extra props should map to invalid_arguments');
    notes.push('additionalProperties enforcement passed');

    // Success envelope should include canonical structured data.
    const ok = await client.request('tools/call', {
      name: 'get_system_info',
      arguments: {},
    });
    assert(ok.isError === false, 'get_system_info should succeed');
    assert(ok.structuredContent && ok.structuredContent.ok === true, 'success envelope should include ok=true');
    assert(ok.structuredContent.data && ok.structuredContent.data.cpu, 'success envelope should include data payload');
    notes.push('success structured envelope passed');

    // Image tools should include fallback metadata when target is missing.
    const img = await client.request('tools/call', {
      name: 'screenshot_window',
      arguments: { pid: -999999 },
    }, 30000);
    assert(img.isError === false, 'screenshot_window fallback should still succeed');
    assert(Array.isArray(img.content) && img.content[0] && img.content[0].type === 'image', 'expected image content');
    assert(img.structuredContent && img.structuredContent.imageMeta, 'expected imageMeta structured content');
    assert(img.structuredContent.imageMeta.fallbackUsed === true, 'expected fallbackUsed=true for missing target');
    assert(typeof img.structuredContent.imageMeta.warning === 'string', 'expected warning string in imageMeta');
    notes.push('image metadata envelope passed');

    // Unknown tool should produce structured not_found error.
    const unknown = await client.request('tools/call', {
      name: 'tool_that_does_not_exist',
      arguments: {},
    });
    assert(unknown.isError === true, 'unknown tool should return error result');
    assert(unknown.structuredContent.error.code === 'tool_not_found', 'unknown tool should map to tool_not_found');
    assert(unknown.structuredContent.error.category === 'not_found', 'unknown tool should map to not_found category');
    notes.push('unknown tool envelope passed');

    return {
      notes: notes.join('; '),
      details: {
        checks: 6,
      },
    };
  },
};
