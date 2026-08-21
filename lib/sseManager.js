/* ============================================================================
 * Swasthya Saarthi — Real-time Event (SSE) Manager
 * Pushes live queue updates to subscribed browser clients without polling.
 * Used by: patient queue tracker, doctor live queue, admin overview.
 * ========================================================================== */

const clients = new Map(); // channel -> Set<res>

function channelFor(type, id) {
  return `${type}:${id}`;
}

function subscribe(channel, res) {
  if (!clients.has(channel)) clients.set(channel, new Set());
  clients.get(channel).add(res);

  // Heartbeat to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  res.on('close', () => {
    clearInterval(heartbeat);
    const set = clients.get(channel);
    if (set) {
      set.delete(res);
      if (set.size === 0) clients.delete(channel);
    }
  });
}

function publish(channel, event, data) {
  const set = clients.get(channel);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    res.write(payload);
  }
}

// Convenience helpers
function publishToDoctor(doctorId, data) {
  publish(channelFor('doctor-queue', doctorId), 'queue-update', data);
}

function publishToAppointment(apptId, data) {
  publish(channelFor('appointment', apptId), 'appointment-update', data);
}

function publishToAllAdmins(data) {
  publish('admin-overview', 'overview-update', data);
}

module.exports = {
  channelFor,
  subscribe,
  publish,
  publishToDoctor,
  publishToAppointment,
  publishToAllAdmins
};
