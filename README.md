# POD Order Dashboard — licensed, server-side version

This replaces the old single HTML file. The parsing logic and your data
now run **only on a server you control**. Clients get a link + an access
key, never your code or a file they can inspect, edit, or reuse past
their limit.

## How the restriction actually works

The old HTML-file version tried to enforce rules (expiry, hidden code)
*inside the browser* — which can never really work, because the
browser is the user's machine: they can always view-source, edit
localStorage, or just ignore JavaScript checks.

This version moves everything that matters onto your server:
- The spreadsheet-parsing logic lives in `lib/parse.js` — it never gets
  sent to the browser. The browser only ever receives the finished
  JSON result.
- Each client authenticates with an API key. Your server checks their
  key and their current usage **before** doing any work.
- The upload counter and limit check happen in `server.js`, in a single
  place the client cannot reach or edit.

Because of that, there is nothing for a client to bypass — not by
reading the page source, not by editing values in their browser, not
by resending requests after their limit. The only way around it is
compromising your server itself, which is a different (and much
smaller) problem than trying to protect a file.

## 1. Run it locally first

```bash
npm install
npm start
```

Server runs at `http://localhost:3000`. It stores clients and upload
history as plain JSON files under `data/` — created automatically,
nothing else to configure for a first run, and no native dependencies
to compile (so no Visual Studio Build Tools, no Python, no node-gyp
needed on Windows — `npm install` just works).

## 2. Create a client (one of your paying customers)

```bash
node lib/admin-cli.js create "Acme Logistics" 20 30
#                              name            limit periodDays
```

This prints an **API key once** — copy it immediately and send it to
that client (e.g. by email). It is stored only as a hash in the
database; even you cannot look it up again later. If a client loses
their key, deactivate them and create a fresh client record (or extend
the CLI to support key rotation — see "Extending this" below).

Other admin commands:

```bash
node lib/admin-cli.js list                 # all clients + usage
node lib/admin-cli.js uploads <clientId>   # upload history for one client
node lib/admin-cli.js deactivate <clientId>
node lib/admin-cli.js activate <clientId>
```

## 3. Give the client their link

Send them your server's URL (e.g. `https://yourapp.com`) and their API
key. They open the page, paste the key once, and upload sheets. Each
upload:
- is rejected with an error if they're at their limit (HTTP 403),
- otherwise is parsed server-side and counted against their usage.

## 4. Set your real admin secret

Before deploying anywhere public, set an environment variable:

```bash
export ADMIN_SECRET="something-long-and-random"
```

The default value in `server.js` (`change-me-admin-secret`) is only for
local testing — change it before this is reachable from the internet.

## 5. Deploying on Deplexo specifically

This project includes a `Dockerfile`, which Deplexo deploys directly
from your Git repository.

1. Push this project to GitHub (or GitLab/Bitbucket/Codeberg).
2. In Deplexo, create a new app from that repo — it will detect the
   `Dockerfile` and build from it.
3. Set the environment variable `ADMIN_SECRET` to a long random value
   in Deplexo's app settings (not the default placeholder).
4. Deploy. Deplexo assigns the container a URL — that's what you give
   clients.
5. To create clients, open `https://<your-deplexo-url>/admin.html` in
   a browser, enter your `ADMIN_SECRET`, and use the form — no
   terminal needed.

**Two things worth knowing about Deplexo's free tier specifically:**
- It caps containers at 128MB RAM and 0.25 CPU. This app is light, but
  parsing a very large spreadsheet with many embedded images could be
  tight on memory — if uploads start failing only on big files, that's
  the likely cause, and the fix is upgrading the plan for more RAM.
- Treat the container's disk as **temporary**: a redeploy can reset it,
  which would wipe `data/clients.json` (your client list and their
  usage counts). For anything beyond quick testing, move client data
  to a real external database (see the Postgres note below) so it
  survives redeploys regardless of which host you use.

## 6. Deploy it somewhere else

Any Node host works: Render, Railway, Fly.io, a small VPS, etc. A few
notes:
- The JSON-file store (`data/clients.json`, `data/uploads.json`) is
  fine for a handful to a few dozen clients. On hosts with ephemeral
  filesystems (most serverless platforms), or once you have many
  clients writing concurrently, switch to a hosted Postgres database
  instead (Supabase and Neon both have free tiers). `lib/db.js` keeps
  all the storage logic in one small file with the same function
  names (`getClientByKeyHash`, `createClient`, etc.), so swapping the
  backend means rewriting mainly that one file — nothing else in the
  app needs to change.
- Set `ADMIN_SECRET` and `PORT` as environment variables on your host.
- Put the app behind HTTPS (most hosts do this for you automatically).

## Project structure

```
server.js            Express app: client auth, upload-limit check, admin API
lib/db.js             SQLite schema + queries (clients, uploads, usage)
lib/auth.js           API key generation/hashing
lib/parse.js           Spreadsheet parsing (ported from the old client-side JS)
lib/admin-cli.js       Command-line tool for you to manage clients
public/index.html      What clients see: sign-in + upload + dashboard
```

## Extending this

- **Billing**: hook Stripe into the admin-create flow so clients can
  self-serve a plan and `uploadLimit` gets set automatically from their
  subscription tier.
- **Per-driver limits instead of per-sheet**: `lib/parse.js` already
  counts distinct orders; you could count distinct drivers per sheet
  and track that instead, by passing a `driverCount` into
  `incrementUsage`.
- **Proper login instead of a bare API key**: swap the `x-api-key`
  header check for email + password with sessions, if you want clients
  to log in from multiple devices more conveniently.
- **Email the API key** instead of copy-pasting it from the terminal —
  wire up a mail provider (Postmark, Resend, etc.) in `admin-cli.js`.

## What this does **not** protect against

- A client who is also a programmer could still write their own script
  that calls your `/api/upload` endpoint directly with their key — but
  it will still be metered and blocked at their limit either way, same
  as using the web page. The limit is enforced by the server
  regardless of what sends the request.
- If a client shares their API key with someone else, that person's
  usage counts against the same client's limit — this is the same
  trade-off every API-key or password system has. Rotate/deactivate a
  key if you suspect it's been shared.
