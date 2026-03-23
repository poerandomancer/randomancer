export type BuildCardData = {
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

export type BuildOgEnv = {
  ASSETS?: {
    fetch: typeof fetch;
  };
};

export type BuildOgSvgResult = {
  svg: string;
  debugHeaders: Record<string, string>;
};

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const TITLE_FONT = "RandomancerDisplay";
const BODY_FONT = "RandomancerBody";
const LABEL_FONT = "RandomancerLabel";
const EXPECTED_LABELS = ["Ascendancy", "Weapons", "Combat", "Defense", "Skills"] as const;
const GROUP_LIMITS: Record<(typeof EXPECTED_LABELS)[number], number> = {
  Ascendancy: 1,
  Weapons: 2,
  Combat: 3,
  Defense: 2,
  Skills: 2,
};

let embeddedFontCssPromise: Promise<string> | null = null;

export async function renderBuildPreviewSvg(cardData: BuildCardData, slug: string, env: BuildOgEnv, assetOrigin: string): Promise<BuildOgSvgResult> {
  const fontCss = await getEmbeddedFontCss(env, assetOrigin);
  const groups = normalizeBuildPreviewGroups(cardData.frontFaceGroups || []);
  const art = await loadOptionalAssetDataUri(env, cardData.ascendancyArtPath || inferAscendancyArtPath(cardData.ascendancy || ""), assetOrigin);
  const title = escapeXml(cardData.title || "Randomancer Build");
  const subtitle = escapeXml(cardData.subtitle || "");
  const cardTypeLabel = escapeXml(cardData.cardTypeLabel || "Randomancer Build Card");
  const className = escapeXml(cardData.className || "Build");
  const slugLabel = escapeXml(`S/BUILD/${slug}`);
  const ascName = escapeXml(cardData.ascendancy || groups[0]?.values[0] || "Unknown Ascendancy");

  const groupMarkup = groups.map((group, index) => {
    const y = 268 + index * 63;
    const values = escapeXml(group.values.join(" • "));
    return `
      <g transform="translate(74 ${y})">
        <rect width="626" height="52" rx="16" fill="rgba(13, 11, 16, 0.82)" stroke="rgba(255, 232, 190, 0.12)" />
        <text x="24" y="22" class="row-label">${escapeXml(group.label)}</text>
        <text x="188" y="31" class="row-value">${values}</text>
      </g>`;
  }).join("");

  const subtitleMarkup = subtitle
    ? `<text x="82" y="212" class="subtitle">${subtitle}</text>`
    : "";

  const artMarkup = art.dataUri
    ? `
      <image href="${art.dataUri}" x="452" y="0" width="748" height="630" preserveAspectRatio="xMidYMid slice" />
      <rect x="452" y="0" width="748" height="630" fill="url(#artVignette)" />
      <rect x="380" y="0" width="820" height="630" fill="url(#sideFade)" />`
    : `<rect x="452" y="0" width="748" height="630" fill="url(#fallbackArtGlow)" />`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        ${fontCss}
        .eyebrow { font: 600 22px '${LABEL_FONT}', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; fill: #E9B16A; }
        .title { font: 700 58px '${TITLE_FONT}', serif; letter-spacing: 0.01em; fill: #F4E8D8; }
        .subtitle { font: 500 28px '${BODY_FONT}', serif; letter-spacing: 0.01em; fill: #D8C4AF; }
        .badge { font: 700 20px '${LABEL_FONT}', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; fill: #F1C98B; }
        .row-label { font: 700 18px '${LABEL_FONT}', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; fill: #E7B26A; }
        .row-value { font: 600 27px '${BODY_FONT}', serif; fill: #F5EEE5; }
        .footer { font: 600 24px '${BODY_FONT}', serif; fill: #DDCFBF; }
        .slug { font: 700 18px '${LABEL_FONT}', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; fill: #E9B16A; }
      </style>
      <linearGradient id="bgGradient" x1="94" y1="56" x2="1030" y2="620" gradientUnits="userSpaceOnUse">
        <stop stop-color="#19131B" />
        <stop offset="0.55" stop-color="#120F17" />
        <stop offset="1" stop-color="#09080D" />
      </linearGradient>
      <radialGradient id="amberGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(144 88) rotate(38) scale(420 240)">
        <stop stop-color="#A35C20" stop-opacity="0.48" />
        <stop offset="1" stop-color="#A35C20" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="fallbackArtGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(930 220) rotate(120) scale(560 440)">
        <stop stop-color="#684225" stop-opacity="0.62" />
        <stop offset="0.55" stop-color="#2C1A14" stop-opacity="0.52" />
        <stop offset="1" stop-color="#110E14" stop-opacity="0.92" />
      </radialGradient>
      <linearGradient id="sideFade" x1="380" y1="315" x2="1150" y2="315" gradientUnits="userSpaceOnUse">
        <stop stop-color="#09080D" stop-opacity="0.96" />
        <stop offset="0.52" stop-color="#09080D" stop-opacity="0.18" />
        <stop offset="1" stop-color="#09080D" stop-opacity="0.56" />
      </linearGradient>
      <linearGradient id="artVignette" x1="826" y1="0" x2="826" y2="630" gradientUnits="userSpaceOnUse">
        <stop stop-color="#000000" stop-opacity="0.18" />
        <stop offset="0.65" stop-color="#000000" stop-opacity="0.05" />
        <stop offset="1" stop-color="#000000" stop-opacity="0.55" />
      </linearGradient>
      <linearGradient id="cardStroke" x1="41" y1="32" x2="1144" y2="598" gradientUnits="userSpaceOnUse">
        <stop stop-color="rgba(255,240,210,0.25)" />
        <stop offset="1" stop-color="rgba(255,240,210,0.08)" />
      </linearGradient>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#000000" flood-opacity="0.36" />
      </filter>
    </defs>

    <rect width="1200" height="630" fill="#08070A" />
    <rect width="1200" height="630" fill="url(#bgGradient)" />
    <rect width="1200" height="630" fill="url(#amberGlow)" />
    ${artMarkup}

    <g filter="url(#softShadow)">
      <rect x="30" y="24" width="1140" height="582" rx="30" fill="rgba(7,7,10,0.72)" />
      <rect x="30.5" y="24.5" width="1139" height="581" rx="29.5" stroke="url(#cardStroke)" />
    </g>

    <g transform="translate(58 44)">
      <rect width="310" height="42" rx="21" fill="rgba(18,16,21,0.84)" stroke="rgba(255, 231, 190, 0.14)" />
      <text x="18" y="27" class="badge">${cardTypeLabel}</text>
    </g>

    <text x="82" y="132" class="eyebrow">${className}</text>
    <text x="82" y="188" class="title">${title}</text>
    ${subtitleMarkup}

    <g transform="translate(760 52)">
      <rect width="360" height="102" rx="24" fill="rgba(9,8,12,0.68)" stroke="rgba(255, 233, 195, 0.1)" />
      <text x="28" y="34" class="row-label">Ascendancy art</text>
      <text x="28" y="72" class="row-value">${ascName}</text>
    </g>

    ${groupMarkup}

    <text x="82" y="584" class="footer">Faithful front-face share preview</text>
    <text x="846" y="584" class="slug">${slugLabel}</text>
  </svg>`;

  return {
    svg,
    debugHeaders: {
      "X-Randomancer-Renderer": "svg-image-transform",
      "X-Randomancer-Font-Mode": "embedded-ttf",
      "X-Randomancer-Art-Path": art.path || "none",
      "X-Randomancer-Art-Status": art.status,
      "X-Randomancer-Groups-Rendered": String(groups.length),
    },
  };
}

export function normalizeBuildPreviewGroups(frontFaceGroups: Array<{ label: string; values: string[] }>): Array<{ label: string; values: string[] }> {
  return EXPECTED_LABELS.map((label) => {
    const matched = frontFaceGroups.find((group) => group.label.toLowerCase() === label.toLowerCase());
    return {
      label,
      values: matched?.values?.map(coerceString).filter(Boolean).slice(0, GROUP_LIMITS[label]) || ["—"],
    };
  });
}

export function inferAscendancyArtPath(ascendancy: string): string {
  const slug = coerceString(ascendancy)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `/images/ascendancies/${slug}.webp` : "";
}

async function getEmbeddedFontCss(env: BuildOgEnv, assetOrigin: string): Promise<string> {
  if (!embeddedFontCssPromise) {
    embeddedFontCssPromise = (async () => {
      const [displayRegular, displayBold, labelBold] = await Promise.all([
        loadRequiredTextAsset(env, "/fonts/DejaVuSerif.ttf.base64.txt", assetOrigin),
        loadRequiredTextAsset(env, "/fonts/DejaVuSerif-Bold.ttf.base64.txt", assetOrigin),
        loadRequiredTextAsset(env, "/fonts/DejaVuSans-Bold.ttf.base64.txt", assetOrigin),
      ]);
      return `
        @font-face { font-family: '${TITLE_FONT}'; src: url(data:font/ttf;base64,${displayBold}) format('truetype'); font-weight: 700; font-style: normal; }
        @font-face { font-family: '${BODY_FONT}'; src: url(data:font/ttf;base64,${displayRegular}) format('truetype'); font-weight: 500 700; font-style: normal; }
        @font-face { font-family: '${LABEL_FONT}'; src: url(data:font/ttf;base64,${labelBold}) format('truetype'); font-weight: 700; font-style: normal; }
      `;
    })();
  }
  return embeddedFontCssPromise;
}

async function loadRequiredTextAsset(env: BuildOgEnv, pathname: string, assetOrigin: string): Promise<string> {
  const url = new URL(pathname, assetOrigin).toString();
  const request = new Request(url);
  const response = env.ASSETS?.fetch ? await env.ASSETS.fetch(request) : await fetch(request);
  if (!response.ok) throw new Error(`Missing required text asset: ${pathname}`);
  return (await response.text()).trim();
}

async function loadOptionalAssetDataUri(env: BuildOgEnv, pathname: string, assetOrigin: string): Promise<{ dataUri: string; path: string; status: string }> {
  if (!pathname) return { dataUri: "", path: "", status: "missing-path" };
  try {
    const result = await fetchAssetBytes(env, pathname, assetOrigin);
    if (!result.ok || !result.bytes) return { dataUri: "", path: pathname, status: `${result.source}:${result.status}:missing` };
    return { dataUri: toDataUri(result.contentType || guessContentType(pathname), result.bytes), path: pathname, status: `${result.source}:${result.status}:embedded` };
  } catch (error) {
    return { dataUri: "", path: pathname, status: `error:${formatUnknownError(error)}` };
  }
}

async function fetchAssetBytes(env: BuildOgEnv, pathname: string, assetOrigin: string): Promise<{ ok: boolean; status: number; source: string; contentType: string; bytes: Uint8Array | null }> {
  const url = new URL(pathname, assetOrigin).toString();
  const request = new Request(url);
  const response = env.ASSETS?.fetch ? await env.ASSETS.fetch(request) : await fetch(request);
  return {
    ok: response.ok,
    status: response.status,
    source: env.ASSETS?.fetch ? "assets-binding" : "direct-fetch",
    contentType: response.headers.get("content-type") || "",
    bytes: response.ok ? new Uint8Array(await response.arrayBuffer()) : null,
  };
}

function toDataUri(contentType: string, bytes: Uint8Array): string {
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function guessContentType(pathname: string): string {
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeXml(value: string): string {
  return coerceString(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
