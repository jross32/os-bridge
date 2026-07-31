'use strict';

const { assert, assertHasKeys } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    const setVisible = await client.callTool('set_execution_profile', {
      mode: 'visible',
      announceActions: true,
      preActionDelayMs: 600,
      notificationTitle: 'os-bridge test',
    });

    assert(setVisible.ok, `Expected set_execution_profile success: ${setVisible.error}`);
    assert(setVisible.json && setVisible.json.profile, 'Expected profile in response');
    assert(setVisible.json.profile.mode === 'visible', 'Expected mode visible');
    assert(setVisible.json.profile.announceActions === true, 'Expected announceActions true');

    const getProfile = await client.callTool('get_execution_profile');
    assert(getProfile.ok, `Expected get_execution_profile success: ${getProfile.error}`);
    assertHasKeys(getProfile.json, ['mode', 'announceActions', 'preActionDelayMs', 'autoApproveThrough'], 'executionProfile');
    assert(getProfile.json.mode === 'visible', 'Expected visible mode after set');

    const setWatch = await client.callTool('set_execution_profile', {
      mode: 'watch',
      autoApproveThrough: 'high',
    });
    assert(setWatch.ok, `Expected set_execution_profile(watch) success: ${setWatch.error}`);
    assert(setWatch.json.profile.mode === 'watch', 'Expected mode watch');
    assert(setWatch.json.profile.announceActions === true, 'Expected announceActions true in watch mode');
    assert(setWatch.json.profile.autoApproveThrough === 'high', 'Expected autoApproveThrough high in watch mode');

    const setQuiet = await client.callTool('set_execution_profile', { mode: 'quiet' });
    assert(setQuiet.ok, `Expected set_execution_profile(quiet) success: ${setQuiet.error}`);
    assert(setQuiet.json.profile.mode === 'quiet', 'Expected mode quiet');
    assert(setQuiet.json.profile.announceActions === false, 'Expected announceActions false in quiet mode');

    return {
      notes: 'Execution profile mode toggling verified',
    };
  },
};
