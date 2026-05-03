'use strict';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertHasKeys(obj, keys, label = 'object') {
  assert(obj && typeof obj === 'object', `${label} is not an object`);
  for (const k of keys) {
    assert(Object.prototype.hasOwnProperty.call(obj, k), `${label} missing key: ${k}`);
  }
}

function assertErrorContains(result, expectedSubstring) {
  assert(result && result.ok === false, 'Expected error result');
  assert(
    String(result.error || '').toLowerCase().includes(String(expectedSubstring).toLowerCase()),
    `Expected error to include: ${expectedSubstring}. Actual: ${result.error}`
  );
}

module.exports = {
  assert,
  assertHasKeys,
  assertErrorContains,
};
