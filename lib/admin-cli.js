#!/usr/bin/env node
// lib/admin-cli.js
// Run directly with Node — no server needs to be running.
//   node lib/admin-cli.js create "Acme Logistics" 20 30
//   node lib/admin-cli.js list
//   node lib/admin-cli.js uploads <clientId>
//   node lib/admin-cli.js deactivate <clientId>

const db = require('./db');
const { generateApiKey, hashApiKey } = require('./auth');

const [, , cmd, ...args] = process.argv;

if (cmd === 'create') {
  const [name, uploadLimit = '10', periodDays = '30', plan = 'basic'] = args;
  if (!name) {
    console.log('Usage: node lib/admin-cli.js create "<name>" [uploadLimit] [periodDays] [plan]');
    process.exit(1);
  }
  const apiKey = generateApiKey();
  const id = db.createClient({
    name,
    apiKeyHash: hashApiKey(apiKey),
    plan,
    uploadLimit: parseInt(uploadLimit, 10),
    periodDays: parseInt(periodDays, 10),
  });
  console.log('Client created.');
  console.log('  id:          ', id);
  console.log('  name:        ', name);
  console.log('  plan:        ', plan);
  console.log('  upload limit:', uploadLimit, 'per', periodDays, 'days');
  console.log('  API KEY (copy this now — it is not stored anywhere recoverable):');
  console.log('  ', apiKey);
} else if (cmd === 'list') {
  console.table(db.listClients());
} else if (cmd === 'uploads') {
  const [clientId] = args;
  console.table(db.listUploadsForClient(Number(clientId)));
} else if (cmd === 'deactivate') {
  const [clientId] = args;
  db.setActive(Number(clientId), false);
  console.log(`Client ${clientId} deactivated.`);
} else if (cmd === 'activate') {
  const [clientId] = args;
  db.setActive(Number(clientId), true);
  console.log(`Client ${clientId} activated.`);
} else {
  console.log(`Commands:
  create "<name>" [uploadLimit=10] [periodDays=30] [plan=basic]
  list
  uploads <clientId>
  deactivate <clientId>
  activate <clientId>`);
}
