export interface Env {
  APP_BASE_URL?: string;
  BUILD_OG_IMAGE_URL?: string;
  CHALLENGE_OG_IMAGE_URL?: string;
  DB: D1Database;
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
  ascendancy?: string;
  className?: string;
  weaponLabel?: string;
  primarySkills?: string[];
  mechanicTags?: string[];
  uniqueHighlights?: string[];
  cohesionLabels?: string[];
  footerText?: string;
};

type ChallengeCardData = {
  title: string;
  subtitle?: string;
  severity?: string;
  category?: string;
  anchorTask?: string;
  twistTask?: string;
  tagChips?: string[];
  footerText?: string;
};

type ParsedSharePageRoute = { kind: CardKind; slug: string };
type PngColor = [number, number, number, number];

type TinyPngCanvas = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

const MAX_PAYLOAD_BYTES = 32 * 1024;
const SHARE_ORIGIN = "https://therandomancer.com";
const LEGACY_SHARE_ORIGIN = "https://cards.therandomancer.com";
const NOT_FOUND_TITLE = "Randomancer Shared Card";
const NOT_FOUND_DESCRIPTION = "This Randomancer share link is unavailable, expired, or invalid.";
const CARD_KIND_PREFIX: Record<CardKind, string> = {
  build: "b",
  challenge: "c",
};
const LONG_CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800, immutable";
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
            "GET /s/build/:slug",
            "GET /s/challenge/:slug",
            "GET /og/build/:slug.png",
            "GET /og/challenge/:slug.png",
            "GET /:slug (legacy redirect)",
          ],
        });
      }

      if (request.method === "GET") {
        const shareMatch = matchSharePath(url.pathname);
        if (shareMatch) return handleSharePage(shareMatch.kind, shareMatch.slug, env);

        const ogMatch = matchOgPath(url.pathname);
        if (ogMatch) return handleOgImage(ogMatch.kind, ogMatch.slug, env);

        const legacySlug = normalizeLegacySlugPath(url.pathname);
        if (legacySlug) {
          const row = await getCardBySlug(env.DB, legacySlug);
          if (row) return Response.redirect(buildCanonicalShareUrl(row.card_kind, row.slug), 301);
        }
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
    const png = renderCardPreviewPng(kind, cardData, slug);
    return new Response(toResponseBody(png), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": LONG_CACHE,
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
  const parsed = parseJson<JsonValue>(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallbackCardDataFromLegacyRow(kind, row);
  const title = coerceString((parsed as Record<string, unknown>).title);
  if (!title) return fallbackCardDataFromLegacyRow(kind, row);
  return parsed as BuildCardData | ChallengeCardData;
}

function fallbackCardDataFromLegacyRow(kind: CardKind, row: PublicCardRow): BuildCardData | ChallengeCardData {
  return kind === "build"
    ? { title: row.meta_title || row.preview_title || "Randomancer Build Card", subtitle: row.meta_description || row.preview_description || "", footerText: "Randomancer build share" }
    : { title: row.meta_title || row.preview_title || "Randomancer Challenge Card", subtitle: row.meta_description || row.preview_description || "", footerText: "Randomancer challenge share" };
}

function renderCardPreviewPng(kind: CardKind, cardData: BuildCardData | ChallengeCardData, slug: string): Uint8Array {
  const canvas = createCanvas(1200, 630, [10, 8, 10, 255]);
  const accent = kind === "build" ? [243, 171, 83, 255] as PngColor : [139, 109, 255, 255] as PngColor;
  const accentSoft = kind === "build" ? [108, 64, 24, 255] as PngColor : [62, 44, 126, 255] as PngColor;
  drawBackground(canvas, kind, accentSoft);
  fillRoundedRect(canvas, 28, 26, 1144, 578, 26, [18, 16, 18, 220]);
  strokeRoundedRect(canvas, 28, 26, 1144, 578, 26, [255, 255, 255, 22]);
  fillRoundedRect(canvas, 54, 54, 62, 62, 18, [255, 255, 255, 22]);
  drawSimpleGlyphIcon(canvas, kind === "build" ? "B" : "C", 75, 69, 5, accent);

  drawTextBlock(canvas, kind === "build" ? "RANDOMANCER BUILD" : "RANDOMANCER CHALLENGE", 136, 64, 3, accent, 900, 1);
  drawTextBlock(canvas, sanitizePreviewText(cardData.title), 56, 154, 6, [246, 239, 226, 255], 760, 1);

  const subtitle = sanitizePreviewText(cardData.subtitle || buildSubtitle(kind, cardData));
  if (subtitle) drawTextBlock(canvas, subtitle, 56, 236, 3, [214, 205, 190, 255], 760, 2);

  const chips = kind === "build"
    ? [
        sanitizePreviewText((cardData as BuildCardData).ascendancy || (cardData as BuildCardData).className || ""),
        sanitizePreviewText((cardData as BuildCardData).weaponLabel || ""),
        ...((cardData as BuildCardData).mechanicTags || []).map(sanitizePreviewText),
      ].filter(Boolean).slice(0, 4)
    : [
        sanitizePreviewText((cardData as ChallengeCardData).severity || ""),
        sanitizePreviewText((cardData as ChallengeCardData).category || ""),
        ...((cardData as ChallengeCardData).tagChips || []).map(sanitizePreviewText),
      ].filter(Boolean).slice(0, 4);
  drawChips(canvas, chips, 56, 326, accent);

  fillRoundedRect(canvas, 860, 72, 284, 316, 22, [255, 255, 255, 16]);
  strokeRoundedRect(canvas, 860, 72, 284, 316, 22, [255, 255, 255, 20]);
  drawTextBlock(canvas, "SNAPSHOT", 888, 98, 2, [198, 189, 176, 255], 220, 1);
  const detailLines = kind === "build"
    ? [
        joinLabelValue("SKILLS", (cardData as BuildCardData).primarySkills),
        joinLabelValue("UNIQUES", (cardData as BuildCardData).uniqueHighlights),
        joinLabelValue("THEMES", (cardData as BuildCardData).cohesionLabels),
      ]
    : [
        joinLabelValue("ANCHOR", [(cardData as ChallengeCardData).anchorTask || ""]),
        joinLabelValue("TWIST", [(cardData as ChallengeCardData).twistTask || ""]),
      ];
  let y = 136;
  for (const line of detailLines.filter(Boolean)) {
    y = drawTextBlock(canvas, sanitizePreviewText(line), 888, y, 2, [240, 232, 220, 255], 220, 3) + 18;
  }

  const footer = sanitizePreviewText(cardData.footerText || "therandomancer.com");
  drawTextBlock(canvas, footer, 56, 566, 2, [210, 201, 187, 255], 500, 1);
  drawTextBlock(canvas, sanitizePreviewText(`${kind === "build" ? "S/BUILD" : "S/CHALLENGE"}/${slug}`), 760, 566, 2, accent, 380, 1);
  return encodePng(canvas);
}

function buildSubtitle(kind: CardKind, cardData: BuildCardData | ChallengeCardData): string {
  if (kind === "build") {
    return [(cardData as BuildCardData).className, (cardData as BuildCardData).weaponLabel].filter(Boolean).join(" - ");
  }
  return [(cardData as ChallengeCardData).anchorTask, (cardData as ChallengeCardData).twistTask].filter(Boolean).join(" - ");
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

function fillRect(canvas: TinyPngCanvas, x: number, y: number, width: number, height: number, color: PngColor): void {
  for (let yy = Math.max(0, y); yy < Math.min(canvas.height, y + height); yy += 1) {
    for (let xx = Math.max(0, x); xx < Math.min(canvas.width, x + width); xx += 1) setPixel(canvas, xx, yy, color);
  }
}

function fillRoundedRect(canvas: TinyPngCanvas, x: number, y: number, width: number, height: number, radius: number, color: PngColor): void {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      if (insideRoundedRect(xx, yy, x, y, width, height, radius)) setPixel(canvas, xx, yy, color);
    }
  }
}

function strokeRoundedRect(canvas: TinyPngCanvas, x: number, y: number, width: number, height: number, radius: number, color: PngColor): void {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      if (!insideRoundedRect(xx, yy, x, y, width, height, radius)) continue;
      const insideInner = insideRoundedRect(xx, yy, x + 1, y + 1, width - 2, height - 2, Math.max(0, radius - 1));
      if (!insideInner) setPixel(canvas, xx, yy, color);
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
  if (!isNonEmptyString(body.schema_version)) return { ok: false, error: "schema_version is required" };
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
  if (isJsonValue(body.card_data)) return { ok: true as const, value: body.card_data };
  if (isRecord(body.preview)) {
    return { ok: true as const, value: { title: coerceString(body.preview.title) || "Randomancer Shared Card", subtitle: coerceString(body.preview.subtitle), footerText: "Randomancer" } };
  }
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
function buildAppUrl(slug: string, env: Env): string { const url = new URL(env.APP_BASE_URL && env.APP_BASE_URL.length > 0 ? env.APP_BASE_URL : SHARE_ORIGIN); url.searchParams.set("card", slug); return url.toString(); }
function normalizeLegacySlugPath(pathname: string): string | null { const slug = pathname.replace(/^\/+/, "").replace(/\/+$/, ""); return /^[bc]-[a-z0-9]{8}$/.test(slug) ? slug : null; }
function matchSharePath(pathname: string): ParsedSharePageRoute | null { const match = pathname.match(/^\/s\/(build|challenge)\/([bc]-[a-z0-9]{8})$/); return match ? { kind: match[1] as CardKind, slug: match[2] } : null; }
function matchOgPath(pathname: string): ParsedSharePageRoute | null { const match = pathname.match(/^\/og\/(build|challenge)\/([bc]-[a-z0-9]{8})\.png$/); return match ? { kind: match[1] as CardKind, slug: match[2] } : null; }
function matchCardApiPath(pathname: string): string | null { return pathname.match(/^\/api\/cards\/([bc]-[a-z0-9]{8})$/)?.[1] ?? null; }
function isApiRequest(pathname: string): boolean { return pathname === "/api/cards/share" || pathname.startsWith("/api/cards/"); }
function json(data: unknown, status = 200, headers?: HeadersInit): Response { return new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } }); }
function html(markup: string, status = 200, headers?: HeadersInit): Response { return new Response(markup, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } }); }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function corsResponse(request: Request): Response { const headers = buildCorsHeaders(request); return new Response(null, { status: 204, headers: headers ?? undefined }); }
function withCors(request: Request, response: Response): Response { const headers = buildCorsHeaders(request); if (!headers) return response; const merged = new Headers(response.headers); headers.forEach((value, key) => merged.set(key, value)); return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged }); }
function buildCorsHeaders(request: Request): Headers | null { const origin = request.headers.get("origin"); if (!origin) return null; const headers = new Headers(); headers.set("access-control-allow-origin", origin); headers.set("vary", "origin"); headers.set("access-control-allow-methods", "GET,POST,OPTIONS"); headers.set("access-control-allow-headers", "content-type,x-randomancer-app-version"); headers.set("access-control-max-age", "86400"); return headers; }
function isCardKind(value: unknown): value is CardKind { return value === "build" || value === "challenge"; }
function isRecord(value: unknown): value is Record<string, any> { return !!value && typeof value === "object" && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isJsonValue(value: unknown): value is JsonValue { return value === null || ["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) ? value.every(isJsonValue) : typeof value === "object" ? Object.values(value as Record<string, unknown>).every(isJsonValue) : false); }
function parseJson<T = unknown>(value: string): T | null { try { return JSON.parse(value) as T; } catch { return null; } }
function coerceString(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function formatError(error: unknown) { return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) }; }

async function fallbackImageResponse(kind: CardKind, env: Env, status: number): Promise<Response> {
  const fallbackUrl = kind === "build" ? env.BUILD_OG_IMAGE_URL || `${LEGACY_SHARE_ORIGIN}/build-share-og.png` : env.CHALLENGE_OG_IMAGE_URL || `${LEGACY_SHARE_ORIGIN}/challenge-share-og.png`;
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
  return new Response(toResponseBody(renderCardPreviewPng(kind, { title: kind === "build" ? "RANDOMANCER BUILD CARD" : "RANDOMANCER CHALLENGE CARD", footerText: "Randomancer fallback" }, "fallback")), { status, headers: { "content-type": "image/png", "cache-control": LONG_CACHE } });
}


function toResponseBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function joinLabelValue(label: string, values?: string[]): string {
  const compact = Array.isArray(values) ? values.filter(Boolean).slice(0, 3) : [];
  return compact.length ? `${label}: ${compact.join(" / ")}` : "";
}
