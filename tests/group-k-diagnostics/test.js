'use strict';
// Wave 4 — System Diagnostics tests

module.exports = {
  async run({ client }) {
    const notes = [];

    // check_service_status — "Spooler" is the print spooler, always present on Windows
    const svcRes = await client.callTool('check_service_status', { name: 'Spooler' });
    assert(svcRes.ok, `check_service_status failed: ${svcRes.text}`);
    const svc = svcRes.json;
    assert(svc.found === true, 'Spooler service should be found');
    assert(typeof svc.displayName === 'string' && svc.displayName.length > 0, 'displayName missing');
    assert(typeof svc.status === 'string', 'status field missing');
    assert(typeof svc.startType === 'string', 'startType field missing');
    notes.push('check_service_status: Spooler found, status=' + svc.status);

    // check_service_status — non-existent service
    const noSvcRes = await client.callTool('check_service_status', { name: 'OsBridgeFakeService12345' });
    assert(noSvcRes.ok, `check_service_status (missing) failed: ${noSvcRes.text}`);
    assert(noSvcRes.json.found === false, 'should return found=false for unknown service');
    notes.push('check_service_status: missing service correctly returned found=false');

    // get_installed_software — filter for "Microsoft" to keep result small
    const swRes = await client.callTool('get_installed_software', { filter: 'Microsoft', limit: 5 });
    assert(swRes.ok, `get_installed_software failed: ${swRes.text}`);
    const sw = swRes.json;
    assert(typeof sw.count === 'number', 'count missing');
    assert(Array.isArray(sw.software), 'software array missing');
    if (sw.software.length > 0) {
      assert(typeof sw.software[0].DisplayName === 'string', 'DisplayName missing in result');
    }
    notes.push(`get_installed_software: ${sw.count} Microsoft entries found`);

    // get_startup_items
    const startupRes = await client.callTool('get_startup_items', {});
    assert(startupRes.ok, `get_startup_items failed: ${startupRes.text}`);
    const startup = startupRes.json;
    assert(typeof startup.count === 'number', 'count missing');
    assert(Array.isArray(startup.items), 'items array missing');
    if (startup.items.length > 0) {
      assert(typeof startup.items[0].name === 'string', 'item name missing');
      assert(typeof startup.items[0].command === 'string', 'item command missing');
    }
    notes.push(`get_startup_items: ${startup.count} startup items`);

    // get_event_log_entries — Application log, last 5 entries
    const evtRes = await client.callTool('get_event_log_entries', { logName: 'Application', limit: 5 });
    assert(evtRes.ok, `get_event_log_entries failed: ${evtRes.text}`);
    const evt = evtRes.json;
    assert(evt.logName === 'Application', 'logName mismatch');
    assert(typeof evt.count === 'number', 'count missing');
    assert(Array.isArray(evt.entries), 'entries array missing');
    if (evt.entries.length > 0) {
      const e = evt.entries[0];
      assert(typeof e.timeGenerated === 'string', 'timeGenerated missing');
      assert(typeof e.source === 'string', 'source missing');
      assert(typeof e.entryType === 'string', 'entryType missing');
    }
    notes.push(`get_event_log_entries: ${evt.count} Application log entries`);

    return { notes: notes.join('; ') };
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
