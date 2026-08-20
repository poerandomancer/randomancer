import jpeg from "jpeg-js";

export interface Env {
  APP_BASE_URL?: string;
  BUILD_OG_IMAGE_URL?: string;
  CHALLENGE_OG_IMAGE_URL?: string;
  DB: D1Database;
  ASSETS?: {
    fetch: typeof fetch;
  };
}

type CardKind = "build" | "challenge";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type ShareRequestBody = {
  schema_version: string;
  card_kind: CardKind;
  app_version?: string;
  payload: JsonValue;
  card_data: JsonValue;
  meta: {
    title: string;
    description: string;
  };
};

type ShareApiResponse = {
  ok: true;
  slug: string;
  created: boolean;
  share_url: string;
  app_url: string;
};

type PublicCardRow = {
  slug: string;
  snapshot_hash: string;
  card_kind: CardKind;
  schema_version: string;
  app_version: string | null;
  payload_json: string;
  card_data_json: string;
  meta_title: string;
  meta_description: string;
  preview_title: string | null;
  preview_subtitle: string | null;
  preview_description: string | null;
  preview_image_url: string | null;
  created_at: string;
  updated_at: string;
};

type BuildCardData = {
  title: string;
  subtitle?: string;
  cardTypeLabel?: string;
  ascendancy?: string;
  ascendancyArtPath?: string;
  className?: string;
  weaponLabel?: string;
  frontFaceGroups?: Array<{
    label: string;
    values: string[];
  }>;
};

type ChallengeCardData = {
  title: string;
  subtitle?: string;
  severity?: string;
  category?: string;
  anchorTask?: string;
  twistTask?: string;
  anchorLabel?: string;
  twistLabel?: string;
  anchorShortLabel?: string;
  twistShortLabel?: string;
  anchorShortName?: string;
  twistShortName?: string;
  anchorName?: string;
  twistName?: string;
  tagChips?: string[];
  footerText?: string;
};

type ParsedSharePageRoute = { kind: CardKind; slug: string };
type ReactionType = "fire" | "cursed" | "big_brain" | "chaotic";
type CardReactionCounts = Record<ReactionType, number>;
type PngColor = [number, number, number, number];

type TinyPngCanvas = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

const MAX_PAYLOAD_BYTES = 32 * 1024;
const SHARE_ORIGIN = "https://therandomancer.com";
const DEFAULT_CARD_ASSET_ORIGIN = "https://cards.therandomancer.com";
const NOT_FOUND_TITLE = "Randomancer Shared Card";
const NOT_FOUND_DESCRIPTION = "This Randomancer share link is unavailable, expired, or invalid.";
const CARD_KIND_PREFIX: Record<CardKind, string> = {
  build: "b",
  challenge: "c",
};
const LONG_CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800, immutable";
const REACTION_TYPES: ReactionType[] = ["fire", "cursed", "big_brain", "chaotic"];
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  ",": ["00000", "00000", "00000", "00000", "00110", "00110", "00100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "'": ["00100", "00100", "00010", "00000", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (isApiRequest(url.pathname)) {
        if (request.method === "OPTIONS") return corsResponse(request);
        if (request.method === "POST" && url.pathname === "/api/cards/share") return withCors(request, await handleShare(request, env));
        const reactionMatch = matchCardReactionApiPath(url.pathname);
        if (reactionMatch && request.method === "GET") return withCors(request, await handleGetReactions(request, reactionMatch, env));
        if (reactionMatch && request.method === "POST") return withCors(request, await handlePostReactions(request, reactionMatch, env));
        const slugMatch = matchCardApiPath(url.pathname);
        if (request.method === "GET" && slugMatch) return withCors(request, await handleGetCard(slugMatch, env));
        return withCors(request, json({ ok: false, error: "Not found" }, 404));
      }

      if (request.method === "GET" && url.pathname === "/") {
        return json({
          ok: true,
          service: "randomancer-card-share",
          routes: [
            "POST /api/cards/share",
            "GET /api/cards/:slug",
            "GET /api/cards/:slug/reactions",
            "POST /api/cards/:slug/reactions",
            "GET /s/build/:slug",
            "GET /s/challenge/:slug",
            "GET /og/build/:slug.png",
            "GET /og/challenge/:slug.png",
          ],
        });
      }

      if (request.method === "GET") {
        const shareMatch = matchSharePath(url.pathname);
        if (shareMatch) return handleSharePage(shareMatch.kind, shareMatch.slug, env);

        const ogMatch = matchOgPath(url.pathname);
        if (ogMatch) return handleOgImage(ogMatch.kind, ogMatch.slug, env);

      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      console.error("[randomancer-card-share] unhandled request failure", { pathname: url.pathname, error: formatError(error) });
      return json({ ok: false, error: "Internal error" }, 500);
    }
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
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);

  const canonicalPayloadJson = stableStringify(parsed.value.payload);
  if (new TextEncoder().encode(canonicalPayloadJson).byteLength > MAX_PAYLOAD_BYTES) {
    return json({ ok: false, error: "Payload exceeds 32 KB limit" }, 413);
  }

  const snapshotHash = await sha256Hex(`${parsed.value.card_kind}\n${canonicalPayloadJson}`);
  const existing = await getCardBySnapshotHash(env.DB, snapshotHash);
  const nowIso = new Date().toISOString();
  const canonicalCardDataJson = stableStringify(parsed.value.card_data);

  if (existing) {
    await env.DB.prepare(
      `UPDATE public_cards
       SET card_kind = ?1,
           schema_version = ?2,
           app_version = ?3,
           payload_json = ?4,
           card_data_json = ?5,
           meta_title = ?6,
           meta_description = ?7,
           preview_title = ?8,
           preview_description = ?9,
           preview_image_url = ?10,
           updated_at = ?11
       WHERE slug = ?12`,
    ).bind(
      parsed.value.card_kind,
      parsed.value.schema_version,
      parsed.value.app_version ?? null,
      canonicalPayloadJson,
      canonicalCardDataJson,
      parsed.value.meta.title,
      parsed.value.meta.description,
      parsed.value.meta.title,
      parsed.value.meta.description,
      buildOgImageUrl(parsed.value.card_kind, existing.slug),
      nowIso,
      existing.slug,
    ).run();

    return json(shareResponse(existing.slug, parsed.value.card_kind, false, env));
  }

  const slug = await createUniqueSlug(env.DB, parsed.value.card_kind);
  await env.DB.prepare(
    `INSERT INTO public_cards (
      slug, snapshot_hash, card_kind, schema_version, app_version, payload_json,
      card_data_json, meta_title, meta_description, preview_title, preview_subtitle,
      preview_description, preview_image_url, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
  ).bind(
    slug,
    snapshotHash,
    parsed.value.card_kind,
    parsed.value.schema_version,
    parsed.value.app_version ?? null,
    canonicalPayloadJson,
    canonicalCardDataJson,
    parsed.value.meta.title,
    parsed.value.meta.description,
    parsed.value.meta.title,
    null,
    parsed.value.meta.description,
    buildOgImageUrl(parsed.value.card_kind, slug),
    nowIso,
    nowIso,
  ).run();

  return json(shareResponse(slug, parsed.value.card_kind, true, env));
}

async function handleGetCard(slug: string, env: Env): Promise<Response> {
  const row = await getCardBySlug(env.DB, slug);
  if (!row) return json({ ok: false, error: "Card not found" }, 404);
  return json(formatCardResponse(row), 200, { "cache-control": "no-store" });
}

async function handleGetReactions(request: Request, slug: string, env: Env): Promise<Response> {
  const row = await getCardBySlug(env.DB, slug);
  if (!row) return json({ ok: false, error: "Card not found" }, 404);

  const reactorKey = getReactorKeyFromHeader(request);
  const reactorHash = reactorKey ? await sha256Hex(reactorKey) : null;
  const counts = await getReactionCounts(env.DB, slug);
  const viewerReaction = reactorHash ? await getViewerReaction(env.DB, slug, reactorHash) : null;

  return json({
    ok: true,
    slug,
    counts,
    viewer_reaction: viewerReaction,
  }, 200, { "cache-control": "no-store" });
}

async function handlePostReactions(request: Request, slug: string, env: Env): Promise<Response> {
  const row = await getCardBySlug(env.DB, slug);
  if (!row) return json({ ok: false, error: "Card not found" }, 404);

  const reactorKey = getReactorKeyFromHeader(request);
  if (!reactorKey) return json({ ok: false, error: "Missing X-Randomancer-Reactor-Key header" }, 400);
  const reactorHash = await sha256Hex(reactorKey);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const parsedReaction = parseReactionType((body as Record<string, unknown>)?.reaction_type);
  if (!parsedReaction) return json({ ok: false, error: "Invalid reaction type" }, 400);

  const existing = await getViewerReaction(env.DB, slug, reactorHash);
  const nowIso = new Date().toISOString();

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO card_reactions (public_card_slug, reactor_hash, reaction_type, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(slug, reactorHash, parsedReaction, nowIso, nowIso).run();
  } else if (existing === parsedReaction) {
    await env.DB.prepare(
      `DELETE FROM card_reactions
       WHERE public_card_slug = ?1 AND reactor_hash = ?2`,
    ).bind(slug, reactorHash).run();
  } else {
    await env.DB.prepare(
      `UPDATE card_reactions
       SET reaction_type = ?3,
           updated_at = ?4
       WHERE public_card_slug = ?1 AND reactor_hash = ?2`,
    ).bind(slug, reactorHash, parsedReaction, nowIso).run();
  }

  const counts = await getReactionCounts(env.DB, slug);
  const viewerReaction = await getViewerReaction(env.DB, slug, reactorHash);
  return json({
    ok: true,
    slug,
    counts,
    viewer_reaction: viewerReaction,
  }, 200, { "cache-control": "no-store" });
}

async function handleSharePage(kind: CardKind, slug: string, env: Env): Promise<Response> {
  const row = await getCardBySlug(env.DB, slug);
  if (!row || row.card_kind !== kind) {
    console.warn("[randomancer-card-share] share slug miss", { kind, slug });
    return renderShareNotFound(kind, slug);
  }

  return html(renderShareHtml({
    title: row.meta_title,
    description: row.meta_description,
    shareUrl: buildCanonicalShareUrl(kind, slug),
    imageUrl: buildOgImageUrl(kind, slug),
    appUrl: buildAppUrl(slug, env),
    heading: row.meta_title,
    kicker: kind === "build" ? "Shared build card" : "Shared challenge card",
    bodyCopy: "Opening the shared Randomancer artifact in the app…",
    notFound: false,
  }), 200, { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" });
}

async function handleOgImage(kind: CardKind, slug: string, env: Env): Promise<Response> {
  const row = await getCardBySlug(env.DB, slug);
  if (!row || row.card_kind !== kind) {
    console.warn("[randomancer-card-share] og slug miss", { kind, slug });
    return fallbackImageResponse(kind, env, 404);
  }

  try {
    const cardData = parseCardData(row.card_data_json, kind, row);
    const rendered = await renderCardPreviewPng(kind, cardData, slug, env, getArtAssetOrigin(env));
    return new Response(toResponseBody(rendered.png), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": LONG_CACHE,
        ...(rendered.debugHeaders || {}),
      },
    });
  } catch (error) {
    console.error("[randomancer-card-share] og render failed", { kind, slug, error: formatError(error) });
    return fallbackImageResponse(kind, env, 200);
  }
}

function renderShareNotFound(kind: CardKind, slug: string): Response {
  return html(renderShareHtml({
    title: NOT_FOUND_TITLE,
    description: NOT_FOUND_DESCRIPTION,
    shareUrl: buildCanonicalShareUrl(kind, slug),
    imageUrl: `${SHARE_ORIGIN}/images/randomancer-banner-og.png`,
    appUrl: SHARE_ORIGIN,
    heading: "Shared card not found",
    kicker: kind === "build" ? "Build share" : "Challenge share",
    bodyCopy: "This shared artifact could not be found. Head back to Randomancer and roll a new one.",
    notFound: true,
  }), 404, { "cache-control": "no-store" });
}

function renderShareHtml(input: {
  title: string;
  description: string;
  shareUrl: string;
  imageUrl: string;
  appUrl: string;
  heading: string;
  kicker: string;
  bodyCopy: string;
  notFound: boolean;
}): string {
  const refresh = input.notFound ? "" : `<meta http-equiv="refresh" content="0;url=${escapeHtml(input.appUrl)}">`;
  const handoffScript = input.notFound ? "" : `<script>window.location.replace(${JSON.stringify(input.appUrl)});</script>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)}</title>
    <link rel="canonical" href="${escapeHtml(input.shareUrl)}">
    <meta name="description" content="${escapeHtml(input.description)}">
    <meta property="og:title" content="${escapeHtml(input.title)}">
    <meta property="og:description" content="${escapeHtml(input.description)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(input.shareUrl)}">
    <meta property="og:image" content="${escapeHtml(input.imageUrl)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(input.title)}">
    <meta name="twitter:description" content="${escapeHtml(input.description)}">
    <meta name="twitter:image" content="${escapeHtml(input.imageUrl)}">
    ${refresh}
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top,#352316 0%,#120d0b 46%,#070608 100%);color:#f6efe2;font-family:Inter,system-ui,sans-serif}
      main{width:min(92vw,520px);padding:28px 24px;border-radius:24px;border:1px solid rgba(231,171,90,.24);background:rgba(11,10,12,.86);box-shadow:0 18px 48px rgba(0,0,0,.35)}
      .k{margin:0 0 10px;color:#e0a04b;letter-spacing:.12em;text-transform:uppercase;font-size:12px}
      h1{margin:0 0 12px;font-size:30px;line-height:1.1}.actions{margin-top:18px;display:flex;gap:12px;flex-wrap:wrap}
      .btn{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border-radius:999px;background:linear-gradient(180deg,#f0b35b,#bf7d24);color:#160f08;text-decoration:none;font-weight:700}
      .ghost{background:transparent;border:1px solid rgba(240,179,91,.4);color:#f6efe2}
    </style>
  </head>
  <body>
    <main>
      <p class="k">${escapeHtml(input.kicker)}</p>
      <h1>${escapeHtml(input.heading)}</h1>
      <p>${escapeHtml(input.bodyCopy)}</p>
      <div class="actions">
        <a class="btn" href="${escapeHtml(input.appUrl)}">${input.notFound ? "Open Randomancer" : "Continue to the app"}</a>
        <a class="btn ghost" href="${escapeHtml(input.shareUrl)}">Refresh share page</a>
      </div>
    </main>
    ${handoffScript}
  </body>
</html>`;
}

function parseCardData(serialized: string, kind: CardKind, row: PublicCardRow): BuildCardData | ChallengeCardData {
  if (row.schema_version !== "public-card.v1") throw new Error("Unsupported card schema");
  const parsed = parseJson<JsonValue>(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid current card data");
  const title = coerceString((parsed as Record<string, unknown>).title);
  if (!title) throw new Error("Current card data requires a title");
  if (kind === "build") return normalizeBuildCardData(parsed as Record<string, unknown>, row);
  return parsed as ChallengeCardData;
}

function normalizeBuildCardData(parsed: Record<string, unknown>, row: PublicCardRow): BuildCardData {
  const frontFaceGroups = Array.isArray(parsed.frontFaceGroups)
    ? parsed.frontFaceGroups
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const record = entry as Record<string, unknown>;
          const label = coerceString(record.label);
          const values = Array.isArray(record.values) ? record.values.map(coerceString).filter(Boolean).slice(0, 4) : [];
          return label && values.length ? { label, values } : null;
        })
        .filter((entry): entry is { label: string; values: string[] } => !!entry)
    : [];
  if (!frontFaceGroups.length) throw new Error("Current Build Card data requires frontFaceGroups");
  const ascendancy = coerceString(parsed.ascendancy);
  return {
    title: coerceString(parsed.title),
    subtitle: coerceString(parsed.subtitle),
    cardTypeLabel: coerceString(parsed.cardTypeLabel) || "Randomancer Build Card",
    ascendancy,
    ascendancyArtPath: coerceString(parsed.ascendancyArtPath) || inferAscendancyArtPath(ascendancy),
    className: coerceString(parsed.className),
    weaponLabel: coerceString(parsed.weaponLabel),
    frontFaceGroups,
  };
}

function inferAscendancyArtPath(ascendancy: string): string {
  const slug = slugifyDisplayText(ascendancy);
  return slug ? `/images/ascendancies/${slug}.webp` : "";
}

async function renderCardPreviewPng(kind: CardKind, cardData: BuildCardData | ChallengeCardData, slug: string, env: Env, assetOrigin = SHARE_ORIGIN): Promise<RenderedPreview> {
  if (kind === "build") return renderBuildPreviewPng(cardData as BuildCardData, slug, env, assetOrigin);
  return renderChallengePreviewPng(cardData as ChallengeCardData, slug, env, assetOrigin);
}

async function renderChallengePreviewPng(cardData: ChallengeCardData, slug: string, env: Env, assetOrigin: string): Promise<RenderedPreview> {
  const canvas = createCanvas(1200, 630, [8, 6, 7, 255]);
  const accent = [154, 78, 62, 255] as PngColor;
  const accentSoft = [86, 34, 24, 255] as PngColor;
  const artDebug = await drawChallengeBackground(canvas, env, accentSoft, assetOrigin);

  fillRoundedRect(canvas, 28, 24, 1144, 582, 30, [8, 8, 10, 148]);
  strokeRoundedRect(canvas, 28, 24, 1144, 582, 30, [192, 116, 92, 28]);
  fillRoundedRect(canvas, 54, 44, 360, 38, 19, [17, 16, 20, 182]);
  strokeRoundedRect(canvas, 54, 44, 360, 38, 19, [192, 116, 92, 26]);
  fillRoundedRect(canvas, 58, 50, 44, 26, 10, [30, 28, 36, 140]);
  drawSimpleGlyphIcon(canvas, "C", 72, 56, 3, accent);
  drawTextBlock(canvas, "RANDOMANCER CHALLENGE", 136, 56, 2, accent, 300, 1);

  drawTextBlock(canvas, sanitizePreviewText(cardData.title), 60, 104, 5, [247, 239, 225, 255], 760, 2);

  const rows = normalizeChallengePreviewRows(cardData);
  let rowY = 246;
  for (const row of rows) {
    const lines = wrapText(sanitizePreviewText(row.value), 2, 748, 6);
    const lineCount = Math.max(1, lines.length);
    const rowHeight = Math.max(52, 22 + lineCount * 18);
    fillRoundedRect(canvas, 58, rowY, 880, rowHeight, 18, [12, 12, 16, 168]);
    strokeRoundedRect(canvas, 58, rowY, 880, rowHeight, 18, [192, 116, 92, 20]);
    drawTextBlock(canvas, sanitizePreviewText(row.label), 78, rowY + 10, 2, accent, 220, 1);
    drawTextBlock(canvas, sanitizePreviewText(row.value), 328, rowY + 10, 2, [242, 236, 228, 255], 590, 6);
    rowY += rowHeight + 16;
  }

  const footer = sanitizePreviewText((cardData as ChallengeCardData).footerText || "Randomancer shared challenge artifact");
  drawTextBlock(canvas, footer, 56, 566, 2, [210, 201, 187, 255], 500, 1);
  drawTextBlock(canvas, sanitizePreviewText(`S/CHALLENGE/${slug}`), 760, 566, 2, accent, 380, 1);

  return {
    png: encodePng(canvas),
    debugHeaders: {
      "X-Randomancer-Art-Path": artDebug.path || "none",
      "X-Randomancer-Art-Status": `${artDebug.fetchStatus};${artDebug.decodeStatus};fallback=${artDebug.usedFallback ? "yes" : "no"}`,
      "X-Randomancer-Challenge-Rows": String(rows.length),
    },
  };
}

function normalizeChallengePreviewRows(cardData: ChallengeCardData): Array<{ label: string; value: string }> {
  const rows = [
    { label: "Severity", value: coerceString(cardData.severity) || "-" },
    { label: pickChallengeTaskLabel(cardData, "anchor"), value: coerceString(cardData.anchorTask) || "-" },
    { label: pickChallengeTaskLabel(cardData, "twist"), value: coerceString(cardData.twistTask) || "-" },
  ];
  return rows.filter((row) => row.label && row.value);
}

function pickChallengeTaskLabel(cardData: ChallengeCardData, kind: "anchor" | "twist"): string {
  const record = cardData as Record<string, unknown>;
  const candidates = kind === "anchor"
    ? ["anchorShortLabel", "anchorLabel", "anchorShortName", "anchorName"]
    : ["twistShortLabel", "twistLabel", "twistShortName", "twistName"];
  for (const key of candidates) {
    const value = coerceString(record[key]);
    if (value) return value;
  }
  return kind === "anchor" ? "Anchor" : "Twist";
}

async function drawChallengeBackground(canvas: TinyPngCanvas, env: Env, accentSoft: PngColor, assetOrigin: string): Promise<BuildArtDebugInfo> {
  drawBackground(canvas, "challenge", accentSoft);
  const artPath = "/images/challenge-background.png";
  const debug: BuildArtDebugInfo = {
    path: artPath,
    fetchStatus: "not-requested",
    contentType: "",
    byteLength: 0,
    decodeStatus: "not-attempted",
    usedFallback: true,
  };

  try {
    const artResult = await loadAssetImage(env, artPath, assetOrigin);
    debug.fetchStatus = artResult.fetchStatus;
    debug.contentType = artResult.contentType;
    debug.byteLength = artResult.byteLength;
    debug.decodeStatus = artResult.decodeStatus;
    if (artResult.image) {
      const cardX = 28;
      const cardY = 24;
      const cardWidth = 1144;
      const cardHeight = 582;
      const cardRadius = 30;
      drawCoverImageRounded(canvas, artResult.image, {
        destX: cardX,
        destY: cardY,
        destWidth: cardWidth,
        destHeight: cardHeight,
        radius: cardRadius,
        alignX: 0.5,
        alignY: 0.5,
        zoom: 1.04,
      });
      fillRoundedRect(canvas, cardX, cardY, cardWidth, cardHeight, cardRadius, [6, 4, 4, 34]);
      applyHorizontalFade(canvas, cardX, cardY, 360, cardHeight, [8, 6, 6, 162], [8, 6, 6, 18]);
      applyHorizontalFade(canvas, cardX + cardWidth - 240, cardY, 240, cardHeight, [0, 0, 0, 12], [0, 0, 0, 88]);
      applyVerticalFade(canvas, cardX, cardY, cardWidth, 104, [0, 0, 0, 72], [0, 0, 0, 8]);
      applyVerticalFade(canvas, cardX, cardY + cardHeight - 132, cardWidth, 132, [0, 0, 0, 6], [0, 0, 0, 96]);
      debug.usedFallback = false;
    }
  } catch (error) {
    debug.fetchStatus = "error";
    debug.decodeStatus = JSON.stringify(formatError(error));
    console.warn("[randomancer-card-share] challenge art lookup failed", { artPath, error: formatError(error) });
  }

  console.log("[randomancer-card-share] challenge art diagnostic", debug);
  return debug;
}

async function renderBuildPreviewPng(cardData: BuildCardData, slug: string, env: Env, assetOrigin: string): Promise<RenderedPreview> {
  const canvas = createCanvas(1200, 630, [8, 7, 9, 255]);
  const accent = [232, 174, 94, 255] as PngColor;
  const accentSoft = [111, 69, 31, 255] as PngColor;
  const artDebug = await drawBuildBackground(canvas, cardData, env, accentSoft, assetOrigin);

  fillRoundedRect(canvas, 28, 24, 1144, 582, 30, [8, 10, 14, 36]);
  fillRoundedRect(canvas, 42, 36, 698, 556, 28, [8, 10, 14, 92]);
  strokeRoundedRect(canvas, 28, 24, 1144, 582, 30, [255, 243, 217, 52]);
  strokeRoundedRect(canvas, 42, 36, 698, 556, 28, [255, 243, 217, 18]);
  fillRoundedRect(canvas, 54, 44, 318, 38, 19, [17, 16, 20, 148]);
  strokeRoundedRect(canvas, 54, 44, 318, 38, 19, [255, 226, 180, 40]);
  drawTextBlock(canvas, sanitizePreviewText(cardData.cardTypeLabel || "Randomancer Build Card"), 72, 56, 2, accent, 280, 1);

  const titleBottom = drawTextBlock(canvas, sanitizePreviewText(cardData.title), 60, 104, 5, [247, 239, 225, 255], 640, 2);
  const subtitleTop = titleBottom + 18;
  if (cardData.subtitle) drawTextBlock(canvas, sanitizePreviewText(cardData.subtitle), 64, subtitleTop, 3, [224, 213, 197, 255], 620, 2);

  const groups = normalizeBuildPreviewGroups(cardData.frontFaceGroups || []);
  const rowTop = 248;
  const rowHeight = 62;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const groupY = rowTop + index * rowHeight;
    fillRoundedRect(canvas, 58, groupY, 612, 52, 18, [10, 12, 18, 116]);
    strokeRoundedRect(canvas, 58, groupY, 612, 52, 18, [255, 227, 180, 36]);
    drawTextBlock(canvas, sanitizePreviewText(group.label), 78, groupY + 10, 2, accent, 150, 1);
    drawTextBlock(canvas, sanitizePreviewText(group.values.join(" / ")), 236, groupY + 10, 2, [242, 236, 228, 255], 408, 2);
  }

  return {
    png: encodePng(canvas),
    debugHeaders: {
      "X-Randomancer-Art-Path": artDebug.path || "none",
      "X-Randomancer-Art-Status": `${artDebug.fetchStatus};${artDebug.decodeStatus};fallback=${artDebug.usedFallback ? "yes" : "no"}`,
      "X-Randomancer-Groups-Rendered": String(groups.length),
    },
  };
}

function normalizeBuildPreviewGroups(frontFaceGroups: Array<{ label: string; values: string[] }>): Array<{ label: string; values: string[] }> {
  const expectedLabels = ["Ascendancy", "Weapons", "Combat", "Defense", "Skills"] as const;
  const limits: Record<(typeof expectedLabels)[number], number> = {
    Ascendancy: 1,
    Weapons: 2,
    Combat: 3,
    Defense: 2,
    Skills: 2,
  };
  return expectedLabels.map((label) => {
    const matched = frontFaceGroups.find((group) => group.label.toLowerCase() === label.toLowerCase());
    return { label, values: matched?.values?.filter(Boolean).slice(0, limits[label]) || ["-"] };
  });
}

async function drawBuildBackground(canvas: TinyPngCanvas, cardData: BuildCardData, env: Env, accentSoft: PngColor, assetOrigin: string): Promise<BuildArtDebugInfo> {
  const cardX = 28;
  const cardY = 24;
  const cardWidth = 1144;
  const cardHeight = 582;
  const cardRadius = 30;

  fillRect(canvas, 0, 0, canvas.width, canvas.height, [0, 0, 0, 255]);

  const artPath = cardData.ascendancyArtPath || inferAscendancyArtPath(cardData.ascendancy || "");
  const debug: BuildArtDebugInfo = {
    path: artPath,
    fetchStatus: artPath ? "not-requested" : "missing-path",
    contentType: "",
    byteLength: 0,
    decodeStatus: artPath ? "not-attempted" : "missing-path",
    usedFallback: true,
  };
  if (artPath) {
    try {
      const artResult = await loadAssetImage(env, artPath, assetOrigin);
      debug.fetchStatus = artResult.fetchStatus;
      debug.contentType = artResult.contentType;
      debug.byteLength = artResult.byteLength;
      debug.decodeStatus = artResult.decodeStatus;
      if (artResult.image) {
        drawCoverImageRounded(canvas, artResult.image, {
          destX: cardX,
          destY: cardY,
          destWidth: cardWidth,
          destHeight: cardHeight,
          radius: cardRadius,
          alignX: 0.85,
          alignY: 0.22,
          zoom: 1.08,
        });

        fillRoundedRect(canvas, cardX, cardY, cardWidth, cardHeight, cardRadius, [0, 0, 0, 18]);

        applyHorizontalFade(canvas, cardX, cardY, 430, cardHeight, [6, 8, 12, 170], [6, 8, 12, 22]);
        applyHorizontalFade(canvas, cardX + cardWidth - 300, cardY, 300, cardHeight, [0, 0, 0, 18], [0, 0, 0, 112]);
        applyVerticalFade(canvas, cardX, cardY, cardWidth, 120, [0, 0, 0, 82], [0, 0, 0, 8]);
        applyVerticalFade(canvas, cardX, cardY + cardHeight - 170, cardWidth, 170, [0, 0, 0, 6], [0, 0, 0, 108]);

        debug.usedFallback = false;
      } else {
        drawBackground(canvas, "build", accentSoft);
      }
      console.log("[randomancer-card-share] build art diagnostic", debug);
      return debug;
    } catch (error) {
      debug.fetchStatus = "error";
      debug.decodeStatus = JSON.stringify(formatError(error));
      console.warn("[randomancer-card-share] build art lookup failed", { artPath, error: formatError(error) });
      drawBackground(canvas, "build", accentSoft);
      console.log("[randomancer-card-share] build art diagnostic", debug);
      return debug;
    }
  }

  drawBackground(canvas, "build", accentSoft);
  console.log("[randomancer-card-share] build art diagnostic", debug);
  return debug;
}

function buildSubtitle(kind: CardKind, cardData: BuildCardData | ChallengeCardData): string {
  if (kind === "build") {
    return [(cardData as BuildCardData).className, (cardData as BuildCardData).weaponLabel].filter(Boolean).join(" - ");
  }
  return [(cardData as ChallengeCardData).anchorTask, (cardData as ChallengeCardData).twistTask].filter(Boolean).join(" - ");
}

function getArtAssetOrigin(env: Env): string {
  const fallback = SHARE_ORIGIN;
  const configured = coerceString(env.APP_BASE_URL);
  if (!configured) return fallback;
  try {
    return new URL(configured).origin;
  } catch {
    return fallback;
  }
}

function sanitizePreviewText(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9 .,:!?'&/\-]/g, " ").replace(/\s+/g, " ").trim();
}

function drawBackground(canvas: TinyPngCanvas, kind: CardKind, accentSoft: PngColor): void {
  for (let y = 0; y < canvas.height; y += 1) {
    const ratio = y / Math.max(1, canvas.height - 1);
    for (let x = 0; x < canvas.width; x += 1) {
      const topGlow = Math.max(0, 1 - distance(x, y, canvas.width * 0.12, canvas.height * 0.08) / 240);
      const bottomGlow = Math.max(0, 1 - distance(x, y, canvas.width * 0.9, canvas.height * 0.84) / 220);
      const r = Math.round(13 + ratio * 12 + topGlow * accentSoft[0] * 0.35 + bottomGlow * 18);
      const g = Math.round(10 + ratio * 8 + topGlow * accentSoft[1] * 0.35 + bottomGlow * 12);
      const b = Math.round(12 + ratio * (kind === "build" ? 6 : 18) + topGlow * accentSoft[2] * 0.35 + bottomGlow * 24);
      setPixel(canvas, x, y, [Math.min(255, r), Math.min(255, g), Math.min(255, b), 255]);
    }
  }
}

function drawChips(canvas: TinyPngCanvas, chips: string[], startX: number, startY: number, accent: PngColor): void {
  let x = startX;
  let y = startY;
  for (const chip of chips) {
    const width = Math.min(250, 22 + chip.length * 12);
    if (x + width > 820) {
      x = startX;
      y += 52;
    }
    fillRoundedRect(canvas, x, y, width, 36, 18, [255, 255, 255, 14]);
    strokeRoundedRect(canvas, x, y, width, 36, 18, [255, 255, 255, 24]);
    drawTextBlock(canvas, chip, x + 14, y + 10, 2, accent, width - 28, 1);
    x += width + 12;
  }
}

function drawSimpleGlyphIcon(canvas: TinyPngCanvas, glyph: string, x: number, y: number, scale: number, color: PngColor): void {
  const pattern = FONT[glyph] || FONT["?"];
  for (let row = 0; row < pattern.length; row += 1) {
    for (let col = 0; col < pattern[row].length; col += 1) {
      if (pattern[row][col] === "1") fillRect(canvas, x + col * scale, y + row * scale, scale, scale, color);
    }
  }
}

function drawTextBlock(canvas: TinyPngCanvas, text: string, x: number, y: number, scale: number, color: PngColor, maxWidth: number, maxLines: number): number {
  const lines = wrapText(text, scale, maxWidth, maxLines);
  let currentY = y;
  for (const line of lines) {
    drawTextLine(canvas, line, x, currentY, scale, color);
    currentY += scale * 9;
  }
  return currentY;
}

function wrapText(text: string, scale: number, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measureText(next, scale) <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = ellipsize(lines[maxLines - 1], scale, maxWidth);
  }
  return lines;
}

function ellipsize(text: string, scale: number, maxWidth: number): string {
  let value = text;
  while (value.length > 1 && measureText(`${value}...`, scale) > maxWidth) value = value.slice(0, -1).trimEnd();
  return `${value}...`;
}

function measureText(text: string, scale: number): number {
  return text.length * (scale * 6) - scale;
}

function drawTextLine(canvas: TinyPngCanvas, text: string, x: number, y: number, scale: number, color: PngColor): void {
  let cursor = x;
  for (const rawChar of text) {
    const char = FONT[rawChar] ? rawChar : rawChar.toUpperCase();
    const pattern = FONT[char] || FONT["?"];
    for (let row = 0; row < pattern.length; row += 1) {
      for (let col = 0; col < pattern[row].length; col += 1) {
        if (pattern[row][col] === "1") fillRect(canvas, cursor + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += scale * 6;
  }
}

function compactTextList(values: Array<string | undefined>): string[] {
  return values.map((value) => coerceString(value)).filter(Boolean);
}

function slugifyDisplayText(value: string): string {
  return coerceString(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

type DecodedAssetImage = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

type BuildArtDebugInfo = {
  path: string;
  fetchStatus: string;
  contentType: string;
  byteLength: number;
  decodeStatus: string;
  usedFallback: boolean;
};

type RenderedPreview = {
  png: Uint8Array;
  debugHeaders?: Record<string, string>;
};

type LoadedAssetImage = {
  image: DecodedAssetImage | null;
  fetchStatus: string;
  contentType: string;
  byteLength: number;
  decodeStatus: string;
};

type AssetFetchResult = {
  response: Response;
  source: string;
};

async function loadAssetImage(env: Env, pathname: string, assetOrigin: string): Promise<LoadedAssetImage> {
  const requestUrl = new URL(pathname, assetOrigin).toString();
  const initial = await fetchAssetRequest(env, requestUrl);
  const contentType = initial.response.headers.get("content-type") || "";
  const bytes = initial.response.ok ? new Uint8Array(await initial.response.arrayBuffer()) : new Uint8Array();
  if (!initial.response.ok) return { image: null, fetchStatus: `${initial.source}:${initial.response.status}`, contentType, byteLength: 0, decodeStatus: "fetch-failed" };

  const decodedByRuntime = await decodeWithImageDecoder(bytes, contentType);
  if (decodedByRuntime) return { image: decodedByRuntime, fetchStatus: `${initial.source}:${initial.response.status}`, contentType, byteLength: bytes.byteLength, decodeStatus: "image-decoder" };
  if (contentType.includes("image/png")) {
    const decoded = await decodePng(bytes);
    return { image: decoded, fetchStatus: `${initial.source}:${initial.response.status}`, contentType, byteLength: bytes.byteLength, decodeStatus: decoded ? "png-decoder" : "png-decode-failed" };
  }
  if (contentType.includes("image/webp")) {
		const chunkTag = detectWebPChunkTag(bytes);
	
		// Keep native/runtime decode first in case the platform supports it later.
		const decoded = decodeWebP(bytes);
		if (decoded) {
			return {
				image: decoded,
				fetchStatus: `${initial.source}:${initial.response.status}`,
				contentType,
				byteLength: bytes.byteLength,
				decodeStatus: `webp-decoder:${chunkTag}`,
			};
		}
	
		// Ask Cloudflare image transformations to transcode the asset to a runtime-decodable format.
		const transcoded = await fetchTranscodedImage(requestUrl);
		const transcodedType = transcoded.response.headers.get("content-type") || "";
		const transcodedBytes = transcoded.response.ok
			? new Uint8Array(await transcoded.response.arrayBuffer())
			: new Uint8Array();
		
		if (transcoded.response.ok) {
			if (transcodedType.includes("image/jpeg")) {
				const jpegDecoded = decodeJpeg(transcodedBytes);
				if (jpegDecoded) {
					return {
						image: jpegDecoded,
						fetchStatus: `${initial.source}:${initial.response.status}|${transcoded.source}:${transcoded.response.status}`,
						contentType: `${contentType} -> ${transcodedType}`,
						byteLength: transcodedBytes.byteLength,
						decodeStatus: `webp-${chunkTag}-via-jpeg-js`,
					};
				}
			}
		
			const runtimeDecoded = await decodeWithImageDecoder(transcodedBytes, transcodedType);
			if (runtimeDecoded) {
				return {
					image: runtimeDecoded,
					fetchStatus: `${initial.source}:${initial.response.status}|${transcoded.source}:${transcoded.response.status}`,
					contentType: `${contentType} -> ${transcodedType}`,
					byteLength: transcodedBytes.byteLength,
					decodeStatus: `webp-${chunkTag}-via-runtime-${transcodedType}`,
				};
			}
		
			if (transcodedType.includes("image/png")) {
				const pngDecoded = await decodePng(transcodedBytes);
				if (pngDecoded) {
					return {
						image: pngDecoded,
						fetchStatus: `${initial.source}:${initial.response.status}|${transcoded.source}:${transcoded.response.status}`,
						contentType: `${contentType} -> ${transcodedType}`,
						byteLength: transcodedBytes.byteLength,
						decodeStatus: `webp-${chunkTag}-via-png`,
					};
				}
			}
		}
		return {
			image: null,
			fetchStatus: `${initial.source}:${initial.response.status}|${transcoded.source}:${transcoded.response.status}`,
			contentType: transcodedType ? `${contentType} -> ${transcodedType}` : contentType,
			byteLength: transcodedBytes.byteLength || bytes.byteLength,
			decodeStatus: `webp-${chunkTag}-decode-failed-after-transform`,
		};
	}
  return { image: null, fetchStatus: `${initial.source}:${initial.response.status}`, contentType, byteLength: bytes.byteLength, decodeStatus: "unsupported-content-type" };
}

async function fetchAssetRequest(env: Env, requestUrl: string): Promise<AssetFetchResult> {
  const request = new Request(requestUrl);
  if (env.ASSETS?.fetch) return { response: await env.ASSETS.fetch(request), source: "assets-binding" };
  return { response: await fetch(request), source: "direct-fetch" };
}

async function fetchTranscodedImage(requestUrl: string): Promise<AssetFetchResult> {
  const response = await fetch(requestUrl, {
    cf: {
      image: {
        format: "baseline-jpeg",
        width: 900,
        quality: 60,
        anim: false,
        metadata: "none",
      },
    },
  } as RequestInit & {
    cf: {
      image: {
        format: string;
        anim: boolean;
        metadata: string;
      };
    };
  });

  const cfResized = response.headers.get("Cf-Resized") || "none";
  return {
    response,
    source: `cf-image-fetch:${cfResized}`,
  };
}

function decodeJpeg(bytes: Uint8Array): DecodedAssetImage | null {
  try {
    const decoded = jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
    });

    if (!decoded?.width || !decoded?.height || !decoded?.data) return null;

    const pixels =
      decoded.data instanceof Uint8Array
        ? decoded.data
        : new Uint8Array(
            decoded.data.buffer,
            decoded.data.byteOffset,
            decoded.data.byteLength,
          );

    return {
      width: decoded.width,
      height: decoded.height,
      pixels,
    };
  } catch {
    return null;
  }
}

async function decodeWithImageDecoder(bytes: Uint8Array, contentType: string): Promise<DecodedAssetImage | null> {
  if (typeof ImageDecoder === "undefined") {
    console.log("[randomancer-card-share] ImageDecoder unavailable", { contentType });
    return null;
  }
  try {
    const decoder = new ImageDecoder({ data: bytes, type: contentType });
    const { image } = await decoder.decode();
    const width = image.displayWidth || image.codedWidth;
    const height = image.displayHeight || image.codedHeight;
    const pixels = new Uint8Array(width * height * 4);
    await image.copyTo(pixels, { layout: [{ offset: 0, stride: width * 4 }] });
    image.close();
    decoder.close();
    return { width, height, pixels };
  } catch (error) {
    console.warn("[randomancer-card-share] ImageDecoder failed", {
      contentType,
      error: formatError(error),
    });
    return null;
  }
}

function drawCoverImage(canvas: TinyPngCanvas, image: DecodedAssetImage, placement: { destX: number; destY: number; destWidth: number; destHeight: number; alignX: number; alignY: number; }): void {
  const scale = Math.max(placement.destWidth / image.width, placement.destHeight / image.height);
  const sampleWidth = Math.max(1, Math.round(placement.destWidth / scale));
  const sampleHeight = Math.max(1, Math.round(placement.destHeight / scale));
  const maxOffsetX = Math.max(0, image.width - sampleWidth);
  const maxOffsetY = Math.max(0, image.height - sampleHeight);
  const sourceX = Math.round(maxOffsetX * placement.alignX);
  const sourceY = Math.round(maxOffsetY * placement.alignY);
  for (let y = 0; y < placement.destHeight; y += 1) {
    const srcY = Math.min(image.height - 1, sourceY + Math.floor((y / placement.destHeight) * sampleHeight));
    for (let x = 0; x < placement.destWidth; x += 1) {
      const srcX = Math.min(image.width - 1, sourceX + Math.floor((x / placement.destWidth) * sampleWidth));
      const idx = (srcY * image.width + srcX) * 4;
      blendPixel(canvas, placement.destX + x, placement.destY + y, [image.pixels[idx], image.pixels[idx + 1], image.pixels[idx + 2], image.pixels[idx + 3]]);
    }
  }
}

function drawCoverImageRounded(canvas: TinyPngCanvas, image: DecodedAssetImage, placement: { destX: number; destY: number; destWidth: number; destHeight: number; radius: number; alignX: number; alignY: number; zoom?: number; }): void {
  const zoom = placement.zoom ?? 1;
	const scale = Math.max(placement.destWidth / image.width, placement.destHeight / image.height) * zoom;
  const sampleWidth = Math.max(1, Math.round(placement.destWidth / scale));
  const sampleHeight = Math.max(1, Math.round(placement.destHeight / scale));
  const maxOffsetX = Math.max(0, image.width - sampleWidth);
  const maxOffsetY = Math.max(0, image.height - sampleHeight);
  const sourceX = Math.round(maxOffsetX * placement.alignX);
  const sourceY = Math.round(maxOffsetY * placement.alignY);

  for (let y = 0; y < placement.destHeight; y += 1) {
    const destY = placement.destY + y;
    const srcY = Math.min(image.height - 1, sourceY + Math.floor((y / placement.destHeight) * sampleHeight));
    for (let x = 0; x < placement.destWidth; x += 1) {
      const destX = placement.destX + x;
      if (!insideRoundedRect(destX, destY, placement.destX, placement.destY, placement.destWidth, placement.destHeight, placement.radius)) continue;
      const srcX = Math.min(image.width - 1, sourceX + Math.floor((x / placement.destWidth) * sampleWidth));
      const idx = (srcY * image.width + srcX) * 4;
      blendPixel(canvas, destX, destY, [image.pixels[idx], image.pixels[idx + 1], image.pixels[idx + 2], image.pixels[idx + 3]]);
    }
  }
}

function applyHorizontalFade(canvas: TinyPngCanvas, x: number, y: number, width: number, height: number, start: PngColor, end: PngColor): void {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      const ratio = width <= 1 ? 0 : (xx - x) / (width - 1);
      blendPixel(canvas, xx, yy, mixColor(start, end, ratio));
    }
  }
}

function applyVerticalFade(canvas: TinyPngCanvas, x: number, y: number, width: number, height: number, start: PngColor, end: PngColor): void {
  for (let yy = y; yy < y + height; yy += 1) {
    const ratio = height <= 1 ? 0 : (yy - y) / (height - 1);
    for (let xx = x; xx < x + width; xx += 1) blendPixel(canvas, xx, yy, mixColor(start, end, ratio));
  }
}

function mixColor(start: PngColor, end: PngColor, ratio: number): PngColor {
  const clamped = Math.max(0, Math.min(1, ratio));
  return [
    Math.round(start[0] + (end[0] - start[0]) * clamped),
    Math.round(start[1] + (end[1] - start[1]) * clamped),
    Math.round(start[2] + (end[2] - start[2]) * clamped),
    Math.round(start[3] + (end[3] - start[3]) * clamped),
  ];
}

function blendPixel(canvas: TinyPngCanvas, x: number, y: number, color: PngColor): void {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const index = (y * canvas.width + x) * 4;
  const alpha = color[3] / 255;
  const inv = 1 - alpha;
  canvas.pixels[index] = Math.round(color[0] * alpha + canvas.pixels[index] * inv);
  canvas.pixels[index + 1] = Math.round(color[1] * alpha + canvas.pixels[index + 1] * inv);
  canvas.pixels[index + 2] = Math.round(color[2] * alpha + canvas.pixels[index + 2] * inv);
  canvas.pixels[index + 3] = Math.min(255, Math.round(color[3] + canvas.pixels[index + 3] * inv));
}

async function decodePng(bytes: Uint8Array): Promise<DecodedAssetImage | null> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idatParts: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = bytesToAscii(bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return null;
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType)) return null;
  const inflated = await inflateZlib(concatBytes(idatParts));
  if (!inflated) return null;
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const pixels = new Uint8Array(width * height * 4);
  let src = 0;
  const prev = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src++];
    row.set(inflated.subarray(src, src + stride));
    src += stride;
    applyPngFilter(row, prev, filter, bytesPerPixel);
    for (let x = 0; x < width; x += 1) {
      const source = x * bytesPerPixel;
      const dest = (y * width + x) * 4;
      pixels[dest] = row[source];
      pixels[dest + 1] = row[source + 1];
      pixels[dest + 2] = row[source + 2];
      pixels[dest + 3] = bytesPerPixel === 4 ? row[source + 3] : 255;
    }
    prev.set(row);
  }
  return { width, height, pixels };
}

function applyPngFilter(row: Uint8Array, prev: Uint8Array, filter: number, bytesPerPixel: number): void {
  if (filter === 0) return;
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
    const up = prev[i] || 0;
    const upLeft = i >= bytesPerPixel ? prev[i - bytesPerPixel] || 0 : 0;
    if (filter === 1) row[i] = (row[i] + left) & 0xff;
    else if (filter === 2) row[i] = (row[i] + up) & 0xff;
    else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[i] = (row[i] + paethPredictor(left, up, upLeft)) & 0xff;
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array | null> {
  const streamed = await inflateZlibStream(bytes);
  if (streamed) return streamed;
  return inflateZlibNoCompression(bytes);
}

async function inflateZlibStream(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const blobPart = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const stream = new Blob([blobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
    const arrayBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch {
    return null;
  }
}

function inflateZlibNoCompression(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 6) return null;
  let offset = 2;
  const chunks: Uint8Array[] = [];
  while (offset < bytes.length - 4) {
    const header = bytes[offset++];
    const btype = (header >> 1) & 0x03;
    const isFinal = header & 0x01;
    if (btype !== 0) return null;
    const length = bytes[offset] | (bytes[offset + 1] << 8);
    const nlen = bytes[offset + 2] | (bytes[offset + 3] << 8);
    offset += 4;
    if (((length ^ 0xffff) & 0xffff) !== nlen) return null;
    chunks.push(bytes.subarray(offset, offset + length));
    offset += length;
    if (isFinal) break;
  }
  return concatBytes(chunks);
}

function decodeWebP(bytes: Uint8Array): DecodedAssetImage | null {
  // This decoder intentionally supports only lossless VP8L payloads.
  // Ascendancy art can arrive as lossy VP8 assets, so callers should fall back to a PNG transcode path when VP8L decode is unavailable.
  const riff = bytesToAscii(bytes.subarray(0, 4));
  const webp = bytesToAscii(bytes.subarray(8, 12));
  if (riff !== "RIFF" || webp !== "WEBP") return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const tag = bytesToAscii(bytes.subarray(offset, offset + 4));
    const size = readU32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size + (size % 2);
    if (tag === "VP8L") return decodeWebPLossless(bytes.subarray(dataStart, dataStart + size));
    if (tag === "VP8 ") return null;
    offset = dataEnd;
  }
  return null;
}

function detectWebPChunkTag(bytes: Uint8Array): string {
  if (bytesToAscii(bytes.subarray(0, 4)) !== "RIFF" || bytesToAscii(bytes.subarray(8, 12)) !== "WEBP") return "unknown";
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const tag = bytesToAscii(bytes.subarray(offset, offset + 4));
    const size = readU32LE(bytes, offset + 4);
    if (["VP8 ", "VP8L", "VP8X"].includes(tag)) return tag.trim();
    offset += 8 + size + (size % 2);
  }
  return "unknown";
}

function decodeWebPLossless(chunk: Uint8Array): DecodedAssetImage | null {
  if (chunk.length < 5 || chunk[0] !== 0x2f) return null;
  const bits = new BitReader(chunk.subarray(1));
  const width = bits.readBits(14) + 1;
  const height = bits.readBits(14) + 1;
  bits.readBits(1);
  bits.readBits(3);
  const colorCacheBits = bits.readBits(1) ? bits.readBits(4) : 0;
  const cacheSize = colorCacheBits ? 1 << colorCacheBits : 0;
  const colorCache = cacheSize ? new Uint32Array(cacheSize) : null;
  const pixels = new Uint8Array(width * height * 4);
  const huffmanInfo = readHuffmanGroup(bits, false);
  let x = 0;
  let y = 0;
  let prevGreen = 0;
  while (y < height) {
    const symbol = decodeHuffman(bits, huffmanInfo.main);
    let color = 0;
    if (symbol < 256) {
      const green = (symbol + prevGreen) & 0xff;
      const red = (decodeHuffman(bits, huffmanInfo.red) + green) & 0xff;
      const blue = (decodeHuffman(bits, huffmanInfo.blue) + green) & 0xff;
      const alpha = (decodeHuffman(bits, huffmanInfo.alpha) + green) & 0xff;
      color = (alpha << 24) | (red << 16) | (green << 8) | blue;
      prevGreen = green;
    } else if (symbol >= 256 && symbol < 280) {
      const length = decodeLz77Length(symbol, bits);
      const distSymbol = decodeHuffman(bits, huffmanInfo.distance);
      const distance = decodeLz77Distance(distSymbol, bits);
      for (let i = 0; i < length; i += 1) {
        const target = y * width + x;
        const source = target - distance;
        if (source < 0) return null;
        copyPackedColor(pixels, target, readPackedColor(pixels, source));
        x += 1;
        if (x >= width) { x = 0; y += 1; if (y >= height) break; }
      }
      continue;
    } else if (symbol === 280 && colorCache) {
      const index = bits.readBits(colorCacheBits);
      color = colorCache[index];
    } else {
      return null;
    }

    copyPackedColor(pixels, y * width + x, color);
    if (colorCache) colorCache[hashColor(color, colorCacheBits)] = color;
    x += 1;
    if (x >= width) { x = 0; y += 1; }
  }
  return { width, height, pixels };
}

class BitReader {
  private readonly data: Uint8Array;
  private offset = 0;
  private bit = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readBits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      if (this.offset >= this.data.length) return value;
      const current = (this.data[this.offset] >> this.bit) & 1;
      value |= current << i;
      this.bit += 1;
      if (this.bit === 8) { this.bit = 0; this.offset += 1; }
    }
    return value >>> 0;
  }
}

type HuffmanTree = {
  table: Map<number, number>;
  maxLength: number;
};

type HuffmanGroup = {
  main: HuffmanTree;
  red: HuffmanTree;
  blue: HuffmanTree;
  alpha: HuffmanTree;
  distance: HuffmanTree;
};

function readHuffmanGroup(bits: BitReader, hasMetaPrefix: boolean): HuffmanGroup {
  if (hasMetaPrefix) bits.readBits(1);
  return {
    main: readHuffmanTree(bits, 280),
    red: readHuffmanTree(bits, 256),
    blue: readHuffmanTree(bits, 256),
    alpha: readHuffmanTree(bits, 256),
    distance: readHuffmanTree(bits, 40),
  };
}

function readHuffmanTree(bits: BitReader, alphabetSize: number): HuffmanTree {
  const simple = bits.readBits(1);
  if (simple) {
    const count = bits.readBits(1) + 1;
    const firstCode = bits.readBits(1);
    const symbols = [bits.readBits(1 + 7)];
    if (count >= 2) symbols.push(bits.readBits(8));
    const lengths = new Array(alphabetSize).fill(0);
    lengths[symbols[0]] = 1;
    if (count === 2) lengths[symbols[1]] = 1;
    else lengths[firstCode ? 1 : 0] = 1;
    return buildHuffmanTree(lengths);
  }

  const codeLengthCodeOrder = [17,18,0,1,2,3,4,5,16,6,7,8,9,10,11,12,13,14,15];
  const numCodeLengths = bits.readBits(4) + 4;
  const codeLengthCodeLengths = new Array(19).fill(0);
  for (let i = 0; i < numCodeLengths; i += 1) codeLengthCodeLengths[codeLengthCodeOrder[i]] = bits.readBits(3);
  const codeLengthTree = buildHuffmanTree(codeLengthCodeLengths);
  const lengths: number[] = [];
  while (lengths.length < alphabetSize) {
    const symbol = decodeHuffman(bits, codeLengthTree);
    if (symbol < 16) lengths.push(symbol);
    else if (symbol === 16) {
      const repeat = bits.readBits(2) + 3;
      const last = lengths[lengths.length - 1] || 0;
      for (let i = 0; i < repeat; i += 1) lengths.push(last);
    } else {
      const repeat = bits.readBits(symbol === 17 ? 3 : 7) + (symbol === 17 ? 3 : 11);
      for (let i = 0; i < repeat; i += 1) lengths.push(0);
    }
  }
  return buildHuffmanTree(lengths.slice(0, alphabetSize));
}

function buildHuffmanTree(lengths: number[]): HuffmanTree {
  const maxLength = Math.max(...lengths, 0);
  const blCount = new Array(maxLength + 1).fill(0);
  lengths.forEach((length) => { if (length) blCount[length] += 1; });
  const nextCode = new Array(maxLength + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxLength; bits += 1) {
    code = (code + blCount[bits - 1]) << 1;
    nextCode[bits] = code;
  }
  const table = new Map<number, number>();
  lengths.forEach((length, symbol) => {
    if (!length) return;
    const assigned = nextCode[length]++;
    table.set((length << 16) | reverseBits(assigned, length), symbol);
  });
  return { table, maxLength };
}

function decodeHuffman(bits: BitReader, tree: HuffmanTree): number {
  let code = 0;
  for (let length = 1; length <= tree.maxLength; length += 1) {
    code |= bits.readBits(1) << (length - 1);
    const key = (length << 16) | code;
    if (tree.table.has(key)) return tree.table.get(key) as number;
  }
  return 0;
}

function reverseBits(value: number, length: number): number {
  let result = 0;
  for (let i = 0; i < length; i += 1) {
    result = (result << 1) | (value & 1);
    value >>>= 1;
  }
  return result;
}

function decodeLz77Length(symbol: number, bits: BitReader): number {
  const index = symbol - 256;
  const bases = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073];
  const extra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10];
  if (index >= bases.length) return 1;
  return bases[index] + bits.readBits(extra[index]);
}

function decodeLz77Distance(symbol: number, bits: BitReader): number {
  const bases = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,32769,49153,65537,98305,131073,196609,262145,393217,524289,786433];
  const extra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,14,14,15,15,16,16,17,17,18,18];
  if (symbol >= bases.length) return 1;
  return bases[symbol] + bits.readBits(extra[symbol]);
}

function hashColor(color: number, bits: number): number {
  return ((color * 0x1e35a7bd) >>> (32 - bits)) & ((1 << bits) - 1);
}

function readPackedColor(pixels: Uint8Array, index: number): number {
  const base = index * 4;
  return ((pixels[base + 3] << 24) | (pixels[base] << 16) | (pixels[base + 1] << 8) | pixels[base + 2]) >>> 0;
}

function copyPackedColor(pixels: Uint8Array, index: number, color: number): void {
  const base = index * 4;
  pixels[base] = (color >>> 16) & 0xff;
  pixels[base + 1] = (color >>> 8) & 0xff;
  pixels[base + 2] = color & 0xff;
  pixels[base + 3] = (color >>> 24) & 0xff;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]) | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | ((bytes[offset + 3] << 24) >>> 0)) >>> 0;
}

function bytesToAscii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function createCanvas(width: number, height: number, color: PngColor): TinyPngCanvas {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) pixels.set(color, i * 4);
  return { width, height, pixels };
}

function setPixel(canvas: TinyPngCanvas, x: number, y: number, color: PngColor): void {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const index = (y * canvas.width + x) * 4;
  canvas.pixels[index] = color[0];
  canvas.pixels[index + 1] = color[1];
  canvas.pixels[index + 2] = color[2];
  canvas.pixels[index + 3] = color[3];
}

function paintPixel(canvas: TinyPngCanvas, x: number, y: number, color: PngColor): void {
  if (color[3] >= 255) setPixel(canvas, x, y, color);
  else blendPixel(canvas, x, y, color);
}

function fillRect(canvas: TinyPngCanvas, x: number, y: number, width: number, height: number, color: PngColor): void {
  for (let yy = Math.max(0, y); yy < Math.min(canvas.height, y + height); yy += 1) {
    for (let xx = Math.max(0, x); xx < Math.min(canvas.width, x + width); xx += 1) paintPixel(canvas, xx, yy, color);
  }
}

function fillRoundedRect(canvas: TinyPngCanvas, x: number, y: number, width: number, height: number, radius: number, color: PngColor): void {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      if (insideRoundedRect(xx, yy, x, y, width, height, radius)) paintPixel(canvas, xx, yy, color);
    }
  }
}

function strokeRoundedRect(canvas: TinyPngCanvas, x: number, y: number, width: number, height: number, radius: number, color: PngColor): void {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      if (!insideRoundedRect(xx, yy, x, y, width, height, radius)) continue;
      const insideInner = insideRoundedRect(xx, yy, x + 1, y + 1, width - 2, height - 2, Math.max(0, radius - 1));
      if (!insideInner) paintPixel(canvas, xx, yy, color);
    }
  }
}

function insideRoundedRect(px: number, py: number, x: number, y: number, width: number, height: number, radius: number): boolean {
  const rx = Math.min(radius, Math.floor(width / 2));
  const ry = Math.min(radius, Math.floor(height / 2));
  const left = x + rx;
  const right = x + width - rx - 1;
  const top = y + ry;
  const bottom = y + height - ry - 1;
  if (px >= left && px <= right) return py >= y && py < y + height;
  if (py >= top && py <= bottom) return px >= x && px < x + width;
  const cx = px < left ? left : right;
  const cy = py < top ? top : bottom;
  return (px - cx) ** 2 + (py - cy) ** 2 <= rx ** 2;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x1 - x2, y1 - y2);
}

function encodePng(canvas: TinyPngCanvas): Uint8Array {
  const stride = canvas.width * 4;
  const raw = new Uint8Array((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(canvas.pixels.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = zlibNoCompression(raw);
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return concatBytes([
    signature,
    pngChunk("IHDR", concatBytes([u32be(canvas.width), u32be(canvas.height), Uint8Array.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function zlibNoCompression(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.from([0x78, 0x01])];
  let offset = 0;
  while (offset < data.length) {
    const remaining = data.length - offset;
    const length = Math.min(65535, remaining);
    const isFinal = offset + length >= data.length ? 1 : 0;
    const block = new Uint8Array(length + 5);
    block[0] = isFinal;
    block[1] = length & 0xff;
    block[2] = (length >>> 8) & 0xff;
    const nlen = 0xffff - length;
    block[3] = nlen & 0xff;
    block[4] = (nlen >>> 8) & 0xff;
    block.set(data.subarray(offset, offset + length), 5);
    blocks.push(block);
    offset += length;
  }
  blocks.push(u32be(adler32(data)));
  return concatBytes(blocks);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = concatBytes([typeBytes, data]);
  return concatBytes([u32be(data.length), typeBytes, data, u32be(crc32(crcInput))]);
}

function u32be(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function validateShareRequest(body: unknown): { ok: true; value: ShareRequestBody } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Body must be a JSON object" };
  if (body.schema_version !== "public-card.v1") return { ok: false, error: "schema_version must be public-card.v1" };
  if (!isCardKind(body.card_kind)) return { ok: false, error: "card_kind must be build or challenge" };
  if (!isJsonValue(body.payload)) return { ok: false, error: "payload must be valid JSON" };

  const meta = normalizeMeta(body);
  if (!meta.ok) return meta;
  const cardData = normalizeCardData(body);
  if (!cardData.ok) return cardData;
  if (body.app_version !== undefined && typeof body.app_version !== "string") return { ok: false, error: "app_version must be a string when provided" };

  return {
    ok: true,
    value: {
      schema_version: body.schema_version.trim(),
      card_kind: body.card_kind,
      app_version: body.app_version,
      payload: body.payload,
      card_data: cardData.value,
      meta: meta.value,
    },
  };
}

function normalizeMeta(body: Record<string, unknown>) {
  if (isRecord(body.meta) && isNonEmptyString(body.meta.title) && isNonEmptyString(body.meta.description)) {
    return { ok: true as const, value: { title: body.meta.title.trim(), description: body.meta.description.trim() } };
  }
  if (isRecord(body.preview) && isNonEmptyString(body.preview.title) && isNonEmptyString(body.preview.description)) {
    return { ok: true as const, value: { title: body.preview.title.trim(), description: body.preview.description.trim() } };
  }
  return { ok: false as const, error: "meta.title and meta.description are required" };
}

function normalizeCardData(body: Record<string, unknown>) {
  const cardData = body.card_data;
  if (isRecord(cardData) && isNonEmptyString(cardData.title) && isJsonValue(cardData)) return { ok: true as const, value: cardData };
  return { ok: false as const, error: "card_data must be valid JSON" };
}

async function getCardBySnapshotHash(db: D1Database, snapshotHash: string): Promise<PublicCardRow | null> {
  return (await db.prepare(
    `SELECT slug, snapshot_hash, card_kind, schema_version, app_version,
            payload_json, card_data_json, meta_title, meta_description,
            preview_title, preview_subtitle, preview_description, preview_image_url,
            created_at, updated_at
     FROM public_cards
     WHERE snapshot_hash = ?1
     LIMIT 1`,
  ).bind(snapshotHash).first<PublicCardRow>()) ?? null;
}

async function getCardBySlug(db: D1Database, slug: string): Promise<PublicCardRow | null> {
  return (await db.prepare(
    `SELECT slug, snapshot_hash, card_kind, schema_version, app_version,
            payload_json, card_data_json, meta_title, meta_description,
            preview_title, preview_subtitle, preview_description, preview_image_url,
            created_at, updated_at
     FROM public_cards
     WHERE slug = ?1
     LIMIT 1`,
  ).bind(slug).first<PublicCardRow>()) ?? null;
}

function createZeroReactionCounts(): CardReactionCounts {
  return { fire: 0, cursed: 0, big_brain: 0, chaotic: 0 };
}

function parseReactionType(value: unknown): ReactionType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return REACTION_TYPES.find((reaction) => reaction === normalized) ?? null;
}


function getReactorKeyFromHeader(request: Request): string | null {
  const raw = request.headers.get("x-randomancer-reactor-key");
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

async function getViewerReaction(db: D1Database, slug: string, reactorHash: string): Promise<ReactionType | null> {
  const row = await db.prepare(
    `SELECT reaction_type
     FROM card_reactions
     WHERE public_card_slug = ?1
       AND reactor_hash = ?2
     LIMIT 1`,
  ).bind(slug, reactorHash).first<{ reaction_type: string }>();
  return parseReactionType(row?.reaction_type ?? null);
}

async function getReactionCounts(db: D1Database, slug: string): Promise<CardReactionCounts> {
  const counts = createZeroReactionCounts();
  const row = await db.prepare(
    `SELECT
       SUM(CASE WHEN reaction_type = 'fire' THEN 1 ELSE 0 END) AS fire,
       SUM(CASE WHEN reaction_type = 'cursed' THEN 1 ELSE 0 END) AS cursed,
       SUM(CASE WHEN reaction_type = 'big_brain' THEN 1 ELSE 0 END) AS big_brain,
       SUM(CASE WHEN reaction_type = 'chaotic' THEN 1 ELSE 0 END) AS chaotic
     FROM card_reactions
     WHERE public_card_slug = ?1`,
  ).bind(slug).first<Record<ReactionType, number | null>>();
  if (!row) return counts;
  REACTION_TYPES.forEach((reaction) => {
    const value = Number(row[reaction]);
    counts[reaction] = Number.isFinite(value) && value >= 0 ? value : 0;
  });
  return counts;
}

async function createUniqueSlug(db: D1Database, cardKind: CardKind): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slug = `${CARD_KIND_PREFIX[cardKind]}-${randomSuffix(8)}`;
    const existing = await db.prepare(`SELECT slug FROM public_cards WHERE slug = ?1 LIMIT 1`).bind(slug).first<{ slug: string }>();
    if (!existing) return slug;
  }
  throw new Error("Unable to allocate a unique slug");
}

function randomSuffix(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue as JsonValue)}`).join(",")}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatCardResponse(row: PublicCardRow) {
  return {
    ok: true,
    slug: row.slug,
    card_kind: row.card_kind,
    schema_version: row.schema_version,
    app_version: row.app_version,
    payload: parseJson(row.payload_json),
    card_data: parseJson(row.card_data_json),
    meta: { title: row.meta_title || row.preview_title, description: row.meta_description || row.preview_description },
    preview: {
      title: row.preview_title || row.meta_title,
      subtitle: row.preview_subtitle,
      description: row.preview_description || row.meta_description,
      image_url: buildOgImageUrl(row.card_kind, row.slug),
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function shareResponse(slug: string, kind: CardKind, created: boolean, env: Env): ShareApiResponse {
  return { ok: true, slug, created, share_url: buildCanonicalShareUrl(kind, slug), app_url: buildAppUrl(slug, env) };
}
function buildCanonicalShareUrl(kind: CardKind, slug: string): string { return `${SHARE_ORIGIN}/s/${kind}/${slug}`; }
function buildOgImageUrl(kind: CardKind, slug: string): string { return `${SHARE_ORIGIN}/og/${kind}/${slug}.png`; }
function buildAppUrl(slug: string, env: Env): string { const url = new URL(env.APP_BASE_URL && env.APP_BASE_URL.length > 0 ? env.APP_BASE_URL : SHARE_ORIGIN); url.searchParams.set("sharedCard", slug); return url.toString(); }
function matchSharePath(pathname: string): ParsedSharePageRoute | null { const match = pathname.match(/^\/s\/(build|challenge)\/([bc]-[a-z0-9]{8})$/); return match ? { kind: match[1] as CardKind, slug: match[2] } : null; }
function matchOgPath(pathname: string): ParsedSharePageRoute | null { const match = pathname.match(/^\/og\/(build|challenge)\/([bc]-[a-z0-9]{8})\.png$/); return match ? { kind: match[1] as CardKind, slug: match[2] } : null; }
function matchCardReactionApiPath(pathname: string): string | null { return pathname.match(/^\/api\/cards\/([bc]-[a-z0-9]{8})\/reactions$/)?.[1] ?? null; }
function matchCardApiPath(pathname: string): string | null { return pathname.match(/^\/api\/cards\/([bc]-[a-z0-9]{8})$/)?.[1] ?? null; }
function isApiRequest(pathname: string): boolean { return pathname === "/api/cards/share" || pathname.startsWith("/api/cards/"); }
function json(data: unknown, status = 200, headers?: HeadersInit): Response { return new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } }); }
function html(markup: string, status = 200, headers?: HeadersInit): Response { return new Response(markup, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } }); }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function corsResponse(request: Request): Response { const headers = buildCorsHeaders(request); return new Response(null, { status: 204, headers: headers ?? undefined }); }
function withCors(request: Request, response: Response): Response { const headers = buildCorsHeaders(request); if (!headers) return response; const merged = new Headers(response.headers); headers.forEach((value, key) => merged.set(key, value)); return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged }); }
function buildCorsHeaders(request: Request): Headers | null { const origin = request.headers.get("origin"); if (!origin) return null; const headers = new Headers(); headers.set("access-control-allow-origin", origin); headers.set("vary", "origin"); headers.set("access-control-allow-methods", "GET,POST,OPTIONS"); headers.set("access-control-allow-headers", "content-type,x-randomancer-app-version,x-randomancer-reactor-key"); headers.set("access-control-max-age", "86400"); return headers; }
function isCardKind(value: unknown): value is CardKind { return value === "build" || value === "challenge"; }
function isRecord(value: unknown): value is Record<string, any> { return !!value && typeof value === "object" && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isJsonValue(value: unknown): value is JsonValue { return value === null || ["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) ? value.every(isJsonValue) : typeof value === "object" ? Object.values(value as Record<string, unknown>).every(isJsonValue) : false); }
function parseJson<T = unknown>(value: string): T | null { try { return JSON.parse(value) as T; } catch { return null; } }
function coerceString(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function formatError(error: unknown) { return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) }; }

async function fallbackImageResponse(kind: CardKind, env: Env, status: number): Promise<Response> {
  const fallbackUrl = kind === "build" ? env.BUILD_OG_IMAGE_URL || `${DEFAULT_CARD_ASSET_ORIGIN}/build-share-og.png` : env.CHALLENGE_OG_IMAGE_URL || `${DEFAULT_CARD_ASSET_ORIGIN}/challenge-share-og.png`;
  try {
    const response = await fetch(fallbackUrl);
    if (response.ok) {
      const headers = new Headers(response.headers);
      headers.set("cache-control", LONG_CACHE);
      headers.set("content-type", response.headers.get("content-type") || "image/png");
      return new Response(response.body, { status, headers });
    }
  } catch (error) {
    console.error("[randomancer-card-share] fallback image fetch failed", { kind, fallbackUrl, error: formatError(error) });
  }
  const fallbackPng = await renderCardPreviewPng(kind, { title: kind === "build" ? "RANDOMANCER BUILD CARD" : "RANDOMANCER CHALLENGE CARD", footerText: "Randomancer fallback" }, "fallback", env);
  return new Response(toResponseBody(fallbackPng.png), { status, headers: { "content-type": "image/png", "cache-control": LONG_CACHE } });
}


function toResponseBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function joinLabelValue(label: string, values?: string[]): string {
  const compact = Array.isArray(values) ? values.filter(Boolean).slice(0, 3) : [];
  return compact.length ? `${label}: ${compact.join(" / ")}` : "";
}
