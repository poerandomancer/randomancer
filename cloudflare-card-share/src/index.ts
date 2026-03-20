export interface Env {
  APP_BASE_URL?: string;
  BUILD_OG_IMAGE_URL?: string;
  CHALLENGE_OG_IMAGE_URL?: string;
  DB: D1Database;
}

type CardKind = "build" | "challenge";

type ShareRequestBody = {
  schema_version: "public-card.v1";
  card_kind: CardKind;
  app_version?: string;
  payload: JsonValue;
  preview: {
    title: string;
    subtitle?: string;
    description: string;
    image_kind: CardKind;
  };
};

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type PublicCardRow = {
  slug: string;
  snapshot_hash: string;
  card_kind: CardKind;
  schema_version: string;
  app_version: string | null;
  payload_json: string;
  preview_title: string;
  preview_subtitle: string | null;
  preview_description: string;
  preview_image_url: string;
  created_at: string;
  updated_at: string;
};

const MAX_PAYLOAD_BYTES = 32 * 1024;
const SHARE_ORIGIN = "https://cards.therandomancer.com";
const DEV_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);
const CARD_KIND_PREFIX: Record<CardKind, string> = {
  build: "b",
  challenge: "c",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (isApiRequest(url.pathname)) {
      if (request.method === "OPTIONS") {
        return corsResponse(request);
      }

      if (request.method === "POST" && url.pathname === "/api/cards/share") {
        return withCors(request, await handleShare(request, env));
      }

      const slugMatch = matchCardApiPath(url.pathname);
      if (request.method === "GET" && slugMatch) {
        return withCors(request, await handleGetCard(slugMatch, env));
      }

      return withCors(request, json({ ok: false, error: "Not found" }, 404));
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json(
        {
          ok: true,
          service: "randomancer-card-share",
          routes: ["POST /api/cards/share", "GET /api/cards/:slug", "GET /:slug"],
        },
        200,
      );
    }

    if (request.method === "GET") {
      const slug = normalizeSlugPath(url.pathname);
      if (slug) {
        return handleSharePage(slug, env);
      }
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};

async function handleShare(request: Request, env: Env): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const parsed = validateShareRequest(body);
  if (!parsed.ok) {
    return json({ ok: false, error: parsed.error }, 400);
  }

  const canonicalPayloadJson = stableStringify(parsed.value.payload);
  const payloadBytes = new TextEncoder().encode(canonicalPayloadJson).byteLength;
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    return json({ ok: false, error: "Payload exceeds 32 KB limit" }, 413);
  }

  const snapshotHash = await sha256Hex(
    `${parsed.value.card_kind}\n${canonicalPayloadJson}`,
  );
  const existing = await getCardBySnapshotHash(env.DB, snapshotHash);
  const nowIso = new Date().toISOString();
  const previewImageUrl = getPreviewImageUrl(parsed.value.preview.image_kind, env);

  if (existing) {
    await env.DB
      .prepare(
        `UPDATE public_cards
         SET schema_version = ?1,
             app_version = ?2,
             preview_title = ?3,
             preview_subtitle = ?4,
             preview_description = ?5,
             preview_image_url = ?6,
             updated_at = ?7
         WHERE slug = ?8`,
      )
      .bind(
        parsed.value.schema_version,
        parsed.value.app_version ?? null,
        parsed.value.preview.title,
        parsed.value.preview.subtitle ?? null,
        parsed.value.preview.description,
        previewImageUrl,
        nowIso,
        existing.slug,
      )
      .run();

    return json(shareResponse(existing.slug, false, env), 200);
  }

  const slug = await createUniqueSlug(env.DB, parsed.value.card_kind);
  await env.DB
    .prepare(
      `INSERT INTO public_cards (
        slug,
        snapshot_hash,
        card_kind,
        schema_version,
        app_version,
        payload_json,
        preview_title,
        preview_subtitle,
        preview_description,
        preview_image_url,
        created_at,
        updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      slug,
      snapshotHash,
      parsed.value.card_kind,
      parsed.value.schema_version,
      parsed.value.app_version ?? null,
      canonicalPayloadJson,
      parsed.value.preview.title,
      parsed.value.preview.subtitle ?? null,
      parsed.value.preview.description,
      previewImageUrl,
      nowIso,
      nowIso,
    )
    .run();

  return json(shareResponse(slug, true, env), 200);
}

async function handleGetCard(slug: string, env: Env): Promise<Response> {
  const row = await getCardBySlug(env.DB, slug);
  if (!row) {
    return json({ ok: false, error: "Card not found" }, 404);
  }

  return json(formatCardResponse(row), 200);
}

async function handleSharePage(slug: string, env: Env): Promise<Response> {
  const row = await getCardBySlug(env.DB, slug);
  if (!row) {
    return html(
      "<!doctype html><html><head><title>Card not found</title></head><body><h1>Card not found</h1><p>This shared Randomancer card is unavailable.</p></body></html>",
      404,
    );
  }

  const appUrl = buildAppUrl(slug, env);
  const shareUrl = buildShareUrl(slug);
  const title = row.preview_title;
  const description = row.preview_description;
  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedAppUrl = escapeHtml(appUrl);
  const escapedShareUrl = escapeHtml(shareUrl);
  const escapedImageUrl = escapeHtml(row.preview_image_url);

  return html(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapedTitle}</title>
    <link rel="canonical" href="${escapedShareUrl}">
    <meta property="og:title" content="${escapedTitle}">
    <meta property="og:description" content="${escapedDescription}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapedShareUrl}">
    <meta property="og:image" content="${escapedImageUrl}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapedTitle}">
    <meta name="twitter:description" content="${escapedDescription}">
    <meta name="twitter:image" content="${escapedImageUrl}">
    <meta http-equiv="refresh" content="0;url=${escapedAppUrl}">
  </head>
  <body>
    <p>Opening your Randomancer card… <a href="${escapedAppUrl}">Continue to the app</a>.</p>
    <script>window.location.replace(${JSON.stringify(appUrl)});</script>
  </body>
</html>`,
    200,
  );
}

function validateShareRequest(body: unknown):
  | { ok: true; value: ShareRequestBody }
  | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }

  if (body.schema_version !== "public-card.v1") {
    return { ok: false, error: "schema_version must be public-card.v1" };
  }

  if (!isCardKind(body.card_kind)) {
    return { ok: false, error: "card_kind must be build or challenge" };
  }

  if (!isJsonValue(body.payload)) {
    return { ok: false, error: "payload must be valid JSON" };
  }

  if (!isRecord(body.preview)) {
    return { ok: false, error: "preview must be an object" };
  }

  if (!isNonEmptyString(body.preview.title)) {
    return { ok: false, error: "preview.title is required" };
  }

  if (!isNonEmptyString(body.preview.description)) {
    return { ok: false, error: "preview.description is required" };
  }

  if (!isCardKind(body.preview.image_kind)) {
    return { ok: false, error: "preview.image_kind must be build or challenge" };
  }

  if (body.app_version !== undefined && typeof body.app_version !== "string") {
    return { ok: false, error: "app_version must be a string when provided" };
  }

  if (
    body.preview.subtitle !== undefined &&
    typeof body.preview.subtitle !== "string"
  ) {
    return { ok: false, error: "preview.subtitle must be a string when provided" };
  }

  return {
    ok: true,
    value: {
      schema_version: body.schema_version,
      card_kind: body.card_kind,
      app_version: body.app_version,
      payload: body.payload,
      preview: {
        title: body.preview.title.trim(),
        subtitle: body.preview.subtitle?.trim() || undefined,
        description: body.preview.description.trim(),
        image_kind: body.preview.image_kind,
      },
    },
  };
}

async function getCardBySnapshotHash(
  db: D1Database,
  snapshotHash: string,
): Promise<PublicCardRow | null> {
  return (
    (await db
      .prepare(
        `SELECT slug, snapshot_hash, card_kind, schema_version, app_version,
                payload_json, preview_title, preview_subtitle,
                preview_description, preview_image_url, created_at, updated_at
         FROM public_cards
         WHERE snapshot_hash = ?1
         LIMIT 1`,
      )
      .bind(snapshotHash)
      .first<PublicCardRow>()) ?? null
  );
}

async function getCardBySlug(
  db: D1Database,
  slug: string,
): Promise<PublicCardRow | null> {
  return (
    (await db
      .prepare(
        `SELECT slug, snapshot_hash, card_kind, schema_version, app_version,
                payload_json, preview_title, preview_subtitle,
                preview_description, preview_image_url, created_at, updated_at
         FROM public_cards
         WHERE slug = ?1
         LIMIT 1`,
      )
      .bind(slug)
      .first<PublicCardRow>()) ?? null
  );
}

async function createUniqueSlug(db: D1Database, cardKind: CardKind): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slug = generateSlug(cardKind);
    const existing = await db
      .prepare(`SELECT slug FROM public_cards WHERE slug = ?1 LIMIT 1`)
      .bind(slug)
      .first<{ slug: string }>();

    if (!existing) {
      return slug;
    }
  }

  throw new Error("Unable to allocate a unique slug");
}

function generateSlug(cardKind: CardKind): string {
  return `${CARD_KIND_PREFIX[cardKind]}-${randomSuffix(8)}`;
}

function randomSuffix(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let output = "";
  for (const byte of bytes) {
    output += alphabet[byte % alphabet.length];
  }
  return output;
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function formatCardResponse(row: PublicCardRow) {
  return {
    ok: true,
    slug: row.slug,
    card_kind: row.card_kind,
    schema_version: row.schema_version,
    app_version: row.app_version,
    payload: JSON.parse(row.payload_json),
    preview: {
      title: row.preview_title,
      subtitle: row.preview_subtitle,
      description: row.preview_description,
      image_url: row.preview_image_url,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function shareResponse(slug: string, created: boolean, env: Env) {
  return {
    ok: true,
    slug,
    created,
    share_url: buildShareUrl(slug),
    app_url: buildAppUrl(slug, env),
  };
}

function buildShareUrl(slug: string): string {
  return `${SHARE_ORIGIN}/${slug}`;
}

function buildAppUrl(slug: string, env: Env): string {
  const appBaseUrl = normalizeAppBaseUrl(env.APP_BASE_URL);
  const url = new URL(appBaseUrl);
  url.searchParams.set("card", slug);
  return url.toString();
}

function normalizeAppBaseUrl(appBaseUrl?: string): string {
  return appBaseUrl && appBaseUrl.length > 0
    ? appBaseUrl
    : "https://therandomancer.com";
}

function getPreviewImageUrl(cardKind: CardKind, env: Env): string {
  if (cardKind === "build") {
    return env.BUILD_OG_IMAGE_URL || `${SHARE_ORIGIN}/static/build-share-og.png`;
  }

  return (
    env.CHALLENGE_OG_IMAGE_URL ||
    `${SHARE_ORIGIN}/static/challenge-share-og.png`
  );
}

function normalizeSlugPath(pathname: string): string | null {
  const slug = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!slug) {
    return null;
  }

  return /^[bc]-[a-z0-9]{8}$/.test(slug) ? slug : null;
}

function matchCardApiPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/cards\/([bc]-[a-z0-9]{8})$/);
  return match?.[1] ?? null;
}

function isApiRequest(pathname: string): boolean {
  return pathname === "/api/cards/share" || pathname.startsWith("/api/cards/");
}

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function html(markup: string, status = 200): Response {
  return new Response(markup, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function corsResponse(request: Request): Response {
  const origin = request.headers.get("origin");
  const headers = buildCorsHeaders(origin);
  if (!headers) {
    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204, headers });
}

function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get("origin");
  const headers = buildCorsHeaders(origin);
  if (!headers) {
    return response;
  }

  const merged = new Headers(response.headers);
  headers.forEach((value, key) => {
    merged.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

function buildCorsHeaders(origin: string | null): Headers | null {
  if (!origin) {
    return null;
  }

  if (origin !== "https://therandomancer.com" && !DEV_ALLOWED_ORIGINS.has(origin)) {
    return null;
  }

  return new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  });
}

function isCardKind(value: unknown): value is CardKind {
  return value === "build" || value === "challenge";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }

  if (isRecord(value)) {
    return Object.values(value).every((entry) => isJsonValue(entry));
  }

  return false;
}
