// server.js
const path = require('path');
const express = require('express');
const multer = require('multer');

const db = require('./lib/db');
const { hashApiKey, generateApiKey } = require('./lib/auth');
const { parseWorkbook } = require('./lib/parse');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Wraps a route handler so any thrown error (sync or async) becomes a
// JSON response with the real error message, instead of Express's
// default bare-HTML 500 page — which is what was showing up as a
// confusing "Internal Server Error" with no detail in PowerShell.
function safe(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me-admin-secret';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- client auth middleware ----------------------------------------
function requireClient(req, res, next) {
  const key = req.header('x-api-key');
  if (!key) return res.status(401).json({ error: 'Missing x-api-key header.' });
  const client = db.getClientByKeyHash(hashApiKey(key));
  if (!client) return res.status(401).json({ error: 'Invalid or inactive API key.' });
  req.client = client;
  next();
}

// ---- client-facing API ----------------------------------------------
app.get('/api/usage', requireClient, safe((req, res) => {
  const c = req.client;
  res.json({
    name: c.name,
    plan: c.plan,
    uploads_used: c.uploads_used,
    upload_limit: c.upload_limit,
    period_days: c.period_days,
    period_start: c.period_start,
    remaining: Math.max(0, c.upload_limit - c.uploads_used),
  });
}));

app.post('/api/upload', requireClient, upload.single('file'), async (req, res) => {
  const c = req.client;

  // --- the actual restriction: enforced here, server-side, so there is
  // nothing in the browser for a client to edit or bypass ---
  if (c.uploads_used >= c.upload_limit) {
    return res.status(403).json({
      error: `Upload limit reached (${c.uploads_used}/${c.upload_limit} this period). Upgrade your plan or wait for the next period to reset.`,
    });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file").' });

  const sheetIndex = parseInt(req.query.sheet || '0', 10) || 0;

  try {
    const { sheetNames, headers, orders } = await parseWorkbook(req.file.buffer, sheetIndex);
    const photoCount = orders.reduce((a, o) => a + o.photoCount, 0);

    db.incrementUsage(c.id, {
      filename: req.file.originalname,
      orderCount: orders.length,
      photoCount,
    });

    res.json({
      sheetNames,
      headers,
      orders,
      usage: {
        uploads_used: c.uploads_used + 1,
        upload_limit: c.upload_limit,
        remaining: Math.max(0, c.upload_limit - (c.uploads_used + 1)),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Could not read that file: ' + err.message });
  }
});

// ---- admin API (you, not clients) -----------------------------------
function requireAdmin(req, res, next) {
  if (req.header('x-admin-secret') !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Bad admin secret.' });
  }
  next();
}

app.post('/api/admin/clients', requireAdmin, safe((req, res) => {
  const { name, plan = 'basic', uploadLimit = 10, periodDays = 30 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const apiKey = generateApiKey();
  const id = db.createClient({ name, apiKeyHash: hashApiKey(apiKey), plan, uploadLimit, periodDays });
  // The plain API key is returned ONCE, here, to you as the admin.
  // It is never stored in plain text and cannot be recovered later —
  // generate a new one for the client if they lose it.
  res.json({ id, name, apiKey, plan, uploadLimit, periodDays });
}));

app.get('/api/admin/clients', requireAdmin, safe((req, res) => {
  res.json(db.listClients());
}));

app.get('/api/admin/clients/:id/uploads', requireAdmin, safe((req, res) => {
  res.json(db.listUploadsForClient(Number(req.params.id)));
}));

app.post('/api/admin/clients/:id/active', requireAdmin, safe((req, res) => {
  db.setActive(Number(req.params.id), !!(req.body || {}).active);
  res.json({ ok: true });
}));

// Catch-all error handler: turns any thrown error (including filesystem
// errors like a read-only disk) into a JSON response with a real
// message, and always logs the full stack trace to the server console
// (visible in Render's "Logs" tab) so the actual cause is easy to find.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error.', code: err.code });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`POD dashboard server running on http://localhost:${PORT}`));
