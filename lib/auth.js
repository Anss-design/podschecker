// lib/auth.js
const crypto = require('crypto');

// API keys are shown to the client ONCE (at creation time) and only the
// hash is ever stored — same principle as a password. Nobody who reads
// your database, your code, or your server logs can recover a client's key.
function generateApiKey() {
  return 'pod_' + crypto.randomBytes(24).toString('hex');
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

module.exports = { generateApiKey, hashApiKey };
