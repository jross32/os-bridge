'use strict';

const { assert } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    let state = await client.callTool('get_control_state');
    assert(state.ok, state.error || 'Expected get_control_state success');
    assert(state.json.inputAllowed === true, 'Expected inputAllowed true at baseline');

    const pause = await client.callTool('pause_control');
    assert(pause.ok, pause.error || 'pause_control failed');

    state = await client.callTool('get_control_state');
    assert(state.ok, state.error || 'Expected get_control_state success after pause');
    assert(state.json.userPaused === true, 'Expected userPaused true after pause');
    assert(state.json.inputAllowed === false, 'Expected inputAllowed false while paused');

    const resume = await client.callTool('resume_control');
    assert(resume.ok, resume.error || 'resume_control failed');

    state = await client.callTool('get_control_state');
    assert(state.ok, state.error || 'Expected get_control_state success after resume');
    assert(state.json.userPaused === false, 'Expected userPaused false after resume');

    const stop = await client.callTool('emergency_stop');
    assert(stop.ok, stop.error || 'emergency_stop failed');

    state = await client.callTool('get_control_state');
    assert(state.ok, state.error || 'Expected get_control_state success after emergency_stop');
    assert(state.json.emergencyStopped === true, 'Expected emergencyStopped true after emergency_stop');

    const reset = await client.callTool('reset_emergency_stop');
    assert(reset.ok, reset.error || 'reset_emergency_stop failed');

    state = await client.callTool('get_control_state');
    assert(state.ok, state.error || 'Expected get_control_state success after reset');
    assert(state.json.emergencyStopped === false, 'Expected emergencyStopped false after reset');

    return {
      notes: 'Control state transitions behaved as expected',
    };
  },
};
