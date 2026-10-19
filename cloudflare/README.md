# Cloudflare server

ByteBridge's hosted backend uses Workers and SQLite-backed Durable Objects.

**Server:** https://bytebridge-server.eanongba19.workers.dev

## Setup

From the repository root, install dependencies with `npm install`, then sign in and add secrets through the prompts:

```sh
npx wrangler login
npx wrangler secret put ROOM_CREATION_KEY --config cloudflare/wrangler.jsonc
npx wrangler secret put OPENROUTER_API_KEY --config cloudflare/wrangler.jsonc
```

Secrets only need to be set initially or when rotated. AI is enabled in `wrangler.jsonc`; set `AI_ENABLED` to `"0"` to disable it. The model and request limits are configured there too.

## Deploy updates

```sh
npm run cloudflare:typecheck
npm run cloudflare:build
npm run cloudflare:deploy
```

`cloudflare:build` checks the deployment bundle without publishing. Keep the Durable Object migrations in `wrangler.jsonc`.

Open the server's `/health` endpoint and confirm `ok: true` and `configured: true`. In ByteBridge, use the server URL and creation key to create a room. Collaborators join using invitations.

Keep Cloudflare Access protection off for this endpoint; ByteBridge handles room access itself.

## Local development

Copy `.dev.vars.example` to `.dev.vars` inside this folder and fill in local secrets, then run:

```sh
npm run cloudflare:dev
```

Use the localhost URL printed by Wrangler. Local rooms are separate from deployed rooms; existing Node-server rooms are not migrated automatically.

## What to commit

Commit the source, configuration, and `.dev.vars.example`. Keep real secrets in Cloudflare or the Git-ignored `.dev.vars`; never commit `.wrangler/` local data.

For AI failures, check Cloudflare logs for `ai_request_failed`. Monitor Cloudflare usage and set a spending limit for the AI provider.
