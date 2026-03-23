# cloudflare-card-share

A dedicated Cloudflare Worker for Randomancer public card sharing. It stores frozen public share artifacts in D1, serves app-facing card JSON by slug, returns crawler-safe HTML on canonical `/s/...` URLs, and renders deterministic per-share OG preview PNGs.

## Required environment variables

- `APP_BASE_URL` — defaults to `https://therandomancer.com`
- `BUILD_OG_IMAGE_URL` — branded fallback image URL for build share failures
- `CHALLENGE_OG_IMAGE_URL` — branded fallback image URL for challenge share failures
- `DB` — D1 binding used for the public card store

## Route contract

### API

- `POST /api/cards/share`
  - persists a frozen share artifact
  - returns canonical `share_url` values like `https://therandomancer.com/s/build/:slug`
- `GET /api/cards/:slug`
  - returns the frozen payload snapshot plus compact `card_data` and `meta`

### Public pages

- `GET /s/build/:slug`
- `GET /s/challenge/:slug`

These routes return HTML whose initial source already includes:

- `og:title`
- `og:description`
- `og:image`
- `og:type`
- `twitter:card`
- `twitter:title`
- `twitter:description`
- `twitter:image`

For human visitors the page immediately hands off into the SPA using `?card=:slug`, which preserves the existing app restore path.

### OG images

- `GET /og/build/:slug.png`
- `GET /og/challenge/:slug.png`

These routes render PNG previews from persisted `card_data_json`. If render or lookup fails, the worker falls back to the branded static image URL instead of returning a broken image.

## Data model

The `public_cards` table now stores:

- `slug`
- `card_kind`
- `schema_version`
- `payload_json`
- `card_data_json`
- `meta_title`
- `meta_description`
- `snapshot_hash`
- timestamps

Legacy preview columns remain for backward compatibility and are backfilled into the new fields by migration `0002_share_artifact_metadata.sql`.

## Migrations

Apply locally:

```bash
npm run db:migrate:local
```

Apply remotely:

```bash
npm run db:migrate:remote
```

## Local testing

Start the worker locally:

```bash
npm run dev
```

Manual validation checklist:

```bash
curl -i http://127.0.0.1:8787/s/build/<slug>
curl -i http://127.0.0.1:8787/s/challenge/<slug>
curl -o /tmp/build-preview.png http://127.0.0.1:8787/og/build/<slug>.png
curl -o /tmp/challenge-preview.png http://127.0.0.1:8787/og/challenge/<slug>.png
curl -i http://127.0.0.1:8787/api/cards/<slug>
```

What to verify manually:

1. The share page HTML source already contains the OG/Twitter tags.
2. The page redirects to `https://therandomancer.com/?card=<slug>` (or your local `APP_BASE_URL`) for humans.
3. The PNG preview reflects the persisted artifact title, subtitle, and summary chips instead of the generic fallback.
4. Unknown slugs return a branded not-found page and a fallback image.
5. Existing legacy `/:slug` links redirect to the new canonical `/s/{kind}/{slug}` URL when the slug still exists.
