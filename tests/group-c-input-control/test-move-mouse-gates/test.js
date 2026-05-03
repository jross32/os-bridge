'use strict';

const { assertErrorContains } = require('../../lib/assertions');

module.exports = {
  async run({ client }) {
    await client.callTool('pause_control');
    const whilePaused = await client.callTool('move_mouse', { x: 10, y: 10 });
    assertErrorContains(whilePaused, 'paused');
    await client.callTool('resume_control');

    await client.callTool('emergency_stop');
    const whileStopped = await client.callTool('move_mouse', { x: 10, y: 10 });
    assertErrorContains(whileStopped, 'EMERGENCY_STOP');
    await client.callTool('reset_emergency_stop');

    return {
      notes: 'move_mouse correctly blocked by both safety gates',
    };
  },
};
