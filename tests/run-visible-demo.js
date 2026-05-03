'use strict';

const path = require('path');
const { McpClient } = require('./lib/mcp-client');

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const client = new McpClient(path.join(rootDir, 'mcp-server.js'));

  await client.start();

  try {
    await client.callTool('reset_emergency_stop');
    await client.callTool('resume_control');
    await client.callTool('set_execution_profile', {
      mode: 'visible',
      announceActions: true,
      preActionDelayMs: 900,
      notificationTitle: 'os-bridge visible mode',
    });

    const control = await client.callTool('request_control');
    if (!control.ok) {
      throw new Error(`request_control failed: ${control.error}`);
    }

    await client.callTool('send_notification', {
      title: 'os-bridge',
      message: 'Visible demo starting: mouse wiggle in 1 second.',
    });

    const before = await client.callTool('get_mouse_position');
    if (!before.ok || !before.json) {
      throw new Error(`get_mouse_position failed: ${before.error || 'unknown error'}`);
    }

    const x = Number(before.json.x);
    const y = Number(before.json.y);

    await client.callTool('move_mouse', { x, y });
    await client.callTool('move_mouse', { x: x + 80, y: y + 20 });
    await client.callTool('move_mouse', { x, y });

    await client.callTool('send_notification', {
      title: 'os-bridge',
      message: 'Visible demo complete. Control returned to user.',
    });

    await client.callTool('release_control');
    await client.callTool('set_execution_profile', { mode: 'quiet' });

    process.stdout.write('Visible demo completed successfully.\n');
  } finally {
    try {
      await client.callTool('set_execution_profile', { mode: 'quiet' });
    } catch {
      // Ignore profile reset errors during shutdown.
    }
    await client.stop();
  }
}

main().catch((err) => {
  process.stderr.write(`Visible demo failed: ${err.message}\n`);
  process.exit(1);
});
