// lib/db.js
// A plain JSON-file database. No native code, no compiling, works the
// same on Windows/Mac/Linux and on any host. Fine for the volumes a
// client-metering system like this deals with (clients + an upload
// log) — if you ever need heavier concurrent writes, swap this file
// for a hosted Postgres client (Supabase/Neon) and keep the same
// function names so nothing else in the app needs to change.

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || path.join(os.tmpdir(), 'pod-dashboard-data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const UPLOADS_FILE = path.join(DATA_DIR, 'uploads.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CLIENTS_FILE)) fs.writeFileSync(CLIENTS_FILE, '[]');
  if (!fs.existsSync(UPLOADS_FILE)) fs.writeFileSync(UPLOADS_FILE, '[]');
}
ensureStore();

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return [];
  }
}
function writeJSON(file, data) {
  // write to a temp file then rename — avoids a half-written file if
  // the process is interrupted mid-write
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function nextId(rows) {
  return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
}

function resetPeriodIfElapsed(client) {
  const start = new Date(client.period_start);
  const elapsedDays = (Date.now() - start.getTime()) / 86400000;
  if (elapsedDays >= client.period_days) {
    const clients = readJSON(CLIENTS_FILE);
    const idx = clients.findIndex((c) => c.id === client.id);
    if (idx >= 0) {
      clients[idx].uploads_used = 0;
      clients[idx].period_start = new Date().toISOString();
      writeJSON(CLIENTS_FILE, clients);
      client = clients[idx];
    }
  }
  return client;
}

function getClientByKeyHash(hash) {
  const clients = readJSON(CLIENTS_FILE);
  const client = clients.find((c) => c.api_key_hash === hash && c.active);
  if (!client) return null;
  return resetPeriodIfElapsed(client);
}

function createClient({ name, apiKeyHash, plan = 'basic', uploadLimit = 10, periodDays = 30 }) {
  const clients = readJSON(CLIENTS_FILE);
  const id = nextId(clients);
  const client = {
    id,
    name,
    api_key_hash: apiKeyHash,
    plan,
    upload_limit: uploadLimit,
    period_days: periodDays,
    uploads_used: 0,
    period_start: new Date().toISOString(),
    active: true,
    created_at: new Date().toISOString(),
  };
  clients.push(client);
  writeJSON(CLIENTS_FILE, clients);
  return id;
}

function incrementUsage(clientId, { filename, orderCount, photoCount }) {
  const clients = readJSON(CLIENTS_FILE);
  const idx = clients.findIndex((c) => c.id === clientId);
  if (idx >= 0) {
    clients[idx].uploads_used += 1;
    writeJSON(CLIENTS_FILE, clients);
  }
  const uploads = readJSON(UPLOADS_FILE);
  uploads.push({
    id: nextId(uploads),
    client_id: clientId,
    filename,
    order_count: orderCount,
    photo_count: photoCount,
    uploaded_at: new Date().toISOString(),
  });
  writeJSON(UPLOADS_FILE, uploads);
}

function listClients() {
  return readJSON(CLIENTS_FILE).map(({ api_key_hash, ...rest }) => rest);
}

function listUploadsForClient(clientId) {
  return readJSON(UPLOADS_FILE)
    .filter((u) => u.client_id === clientId)
    .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
}

function setActive(clientId, active) {
  const clients = readJSON(CLIENTS_FILE);
  const idx = clients.findIndex((c) => c.id === clientId);
  if (idx >= 0) {
    clients[idx].active = !!active;
    writeJSON(CLIENTS_FILE, clients);
  }
}

module.exports = {
  getClientByKeyHash,
  createClient,
  incrementUsage,
  listClients,
  listUploadsForClient,
  setActive,
};
