'use strict';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateScenario(scenario) {
  assert(scenario && typeof scenario === 'object', 'Scenario must be an object');
  assert(typeof scenario.id === 'string' && scenario.id.length > 0, 'Scenario id is required');
  assert(Array.isArray(scenario.requiredTools) && scenario.requiredTools.length > 0, 'Scenario requiredTools must be a non-empty array');
  assert(Array.isArray(scenario.steps) && scenario.steps.length > 0, 'Scenario steps must be a non-empty array');

  for (const step of scenario.steps) {
    assert(step && typeof step === 'object', 'Each step must be an object');
    assert(typeof step.id === 'string' && step.id.length > 0, 'Each step needs an id');
    assert(typeof step.tool === 'string' && step.tool.length > 0, `Step ${step.id} needs a tool`);
  }
}

function validateProfile(profile) {
  assert(profile && typeof profile === 'object', 'Profile must be an object');
  assert(typeof profile.id === 'string' && profile.id.length > 0, 'Profile id is required');
  assert(profile.executionProfile && typeof profile.executionProfile === 'object', 'Profile executionProfile is required');

  const mode = profile.executionProfile.mode;
  assert(mode === 'quiet' || mode === 'visible' || mode === 'watch', 'Profile mode must be quiet, visible, or watch');
}

module.exports = {
  validateScenario,
  validateProfile,
};
