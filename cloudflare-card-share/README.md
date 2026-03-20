# cloudflare-card-share

A dedicated Cloudflare Worker for Randomancer public card sharing. It stores intentionally shared card snapshots in D1, serves app-facing card JSON by slug, and returns OG/Twitter metadata HTML on the public share URL.

## Required environment variables

Set these in `wrangler.jsonc` and/or via `wrangler secret put` / dashboard configuration:

- `APP_BASE_URL` — defaults to `https://therandomancer.com`
- `BUILD_OG_IMAGE_URL` — static branded image URL for build shares
- `CHALLENGE_OG_IMAGE_URL` — static branded image URL for challenge shares
- `DB` — D1 binding used for the public card store

## D1 setup and binding

1. Create the D1 database:
   ```bash
   npx wrangler d1 create randomancer-card-share-db
   ```
2. Copy the returned `database_id` into `wrangler.jsonc` under the `DB` binding.
3. Ensure the binding name remains `DB`.

## Migrations

Apply the initial schema locally:

```bash
npm run db:migrate:local
```

Apply the schema remotely:

```bash
npm run db:migrate:remote
```

## Type generation

Regenerate worker types after changing bindings or vars:

```bash
npm run cf-typegen
```

## Deploy

```bash
npm run deploy
```

## Routes

- `POST /api/cards/share`
- `GET /api/cards/:slug`
- `GET /:slug`
- `GET /`
