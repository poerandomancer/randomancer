export interface Env {
  DB: D1Database;
  POE_COOKIE?: string;
  POE_USER_AGENT?: string;
  PRICE_SNAPSHOT_TTL_HOURS?: string;
}

type Listing = {
  id?: string;
  price?: string | null;
  price_amount?: number | null;
  price_currency?: string | null;
  account?: string | null;
  indexed?: string | null;
};

type PriceStats = {
  currency: string;
  min: number;
  median: number;
  max: number;
  estimate_text: string;
  priced_sample_size: number;
  estimate_basis: string;
  mixed_currencies_in_sample: boolean;
  currencies_seen: string[];
};

type SnapshotMeta = {
  source: "live" | "cache" | "stale-cache";
  fetched_at: string;
  fresh_until: string;
  stale: boolean;
  ttl_hours: number;
};

type PricecheckResponse = {
  ok: boolean;
  league: string;
  item_name: string;
  cheapest_price?: string | null;
  estimated_price?: string | null;
  sample_size?: number;
  estimate_sample_size?: number;
  estimate_basis?: string | null;
  price_stats?: PriceStats | null;
  listings?: Listing[];
  snapshot_meta?: SnapshotMeta;
  error?: string;
};

type SnapshotRow = {
  league_norm: string;
  item_name_norm: string;
  league: string;
  item_name: string;
  estimated_price: string | null;
  result_json: string;
  fetched_at: string;
  fresh_until: string;
  created_at: string;
  updated_at: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/pricecheck/unique") {
      return handleUniquePricecheck(url, env);
    }

    return json(
      {
        ok: true,
        message: "Randomancer market API is running.",
        example:
          "/api/pricecheck/unique?league=Standard&name=Astramentis",
      },
      200,
    );
  },
};

async function handleUniquePricecheck(
  url: URL,
  env: Env,
): Promise<Response> {
  const league = url.searchParams.get("league") || "Standard";
  const name = url.searchParams.get("name");
  const view = (url.searchParams.get("view") || "concise").toLowerCase();
  const verbose = view === "verbose";

  if (!name) {
    return json(
      { ok: false, error: "Missing required query parameter: name" },
      400,
    );
  }

  try {
    const result = await getPricecheckResult({ league, name, env });
    return json(formatPricecheckResponse(result, verbose), 200);
  } catch (err) {
    return json(
      {
        ok: false,
        league,
        item_name: name,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      502,
    );
  }
}

async function getPricecheckResult(args: {
  league: string;
  name: string;
  env: Env;
}): Promise<PricecheckResponse> {
  const { league, name, env } = args;
  const ttlHours = getSnapshotTtlHours(env);
  const leagueNorm = normalizeKeyPart(league);
  const itemNameNorm = normalizeKeyPart(name);
  const nowIso = new Date().toISOString();

  const cached = await getSnapshot(env.DB, leagueNorm, itemNameNorm);
  if (cached && isFreshSnapshot(cached, nowIso)) {
    return withSnapshotMeta(parseStoredResult(cached), {
      source: "cache",
      fetched_at: cached.fetched_at,
      fresh_until: cached.fresh_until,
      stale: false,
      ttl_hours: ttlHours,
    });
  }

  try {
    const live = await fetchUniqueListingsAndEstimate({ league, name, env });
    const fetchedAt = new Date().toISOString();
    const freshUntil = addHoursIso(fetchedAt, ttlHours);

    await saveSnapshot(env.DB, {
      league_norm: leagueNorm,
      item_name_norm: itemNameNorm,
      league,
      item_name: name,
      estimated_price: live.estimated_price ?? null,
      result_json: JSON.stringify(stripSnapshotMeta(live)),
      fetched_at: fetchedAt,
      fresh_until: freshUntil,
      now_iso: fetchedAt,
    });

    return withSnapshotMeta(live, {
      source: "live",
      fetched_at: fetchedAt,
      fresh_until: freshUntil,
      stale: false,
      ttl_hours: ttlHours,
    });
  } catch (err) {
    if (cached) {
      return withSnapshotMeta(parseStoredResult(cached), {
        source: "stale-cache",
        fetched_at: cached.fetched_at,
        fresh_until: cached.fresh_until,
        stale: true,
        ttl_hours: ttlHours,
      });
    }

    throw err;
  }
}

async function getSnapshot(
  db: D1Database,
  leagueNorm: string,
  itemNameNorm: string,
): Promise<SnapshotRow | null> {
  const row = await db
    .prepare(
      `SELECT
        league_norm,
        item_name_norm,
        league,
        item_name,
        estimated_price,
        result_json,
        fetched_at,
        fresh_until,
        created_at,
        updated_at
      FROM item_price_snapshots
      WHERE league_norm = ?1 AND item_name_norm = ?2
      LIMIT 1`,
    )
    .bind(leagueNorm, itemNameNorm)
    .first<SnapshotRow>();

  return row ?? null;
}

async function saveSnapshot(
  db: D1Database,
  row: {
    league_norm: string;
    item_name_norm: string;
    league: string;
    item_name: string;
    estimated_price: string | null;
    result_json: string;
    fetched_at: string;
    fresh_until: string;
    now_iso: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO item_price_snapshots (
        league_norm,
        item_name_norm,
        league,
        item_name,
        estimated_price,
        result_json,
        fetched_at,
        fresh_until,
        created_at,
        updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
      ON CONFLICT(league_norm, item_name_norm) DO UPDATE SET
        league = excluded.league,
        item_name = excluded.item_name,
        estimated_price = excluded.estimated_price,
        result_json = excluded.result_json,
        fetched_at = excluded.fetched_at,
        fresh_until = excluded.fresh_until,
        updated_at = excluded.updated_at`,
    )
    .bind(
      row.league_norm,
      row.item_name_norm,
      row.league,
      row.item_name,
      row.estimated_price,
      row.result_json,
      row.fetched_at,
      row.fresh_until,
      row.now_iso,
    )
    .run();
}

async function fetchUniqueListingsAndEstimate(args: {
  league: string;
  name: string;
  env: Env;
}): Promise<PricecheckResponse> {
  const { league, name, env } = args;

  const searchUrl = `https://www.pathofexile.com/api/trade2/search/poe2/${encodeURIComponent(
    league,
  )}`;

  const searchBody = buildUniqueSearchBody(name);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent":
      env.POE_USER_AGENT ||
      "RandomancerMarketPOC/0.1 (contact: you@example.com)",
  };

  if (env.POE_COOKIE) {
    headers.cookie = env.POE_COOKIE;
  }

  const searchResp = await fetch(searchUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(searchBody),
  });

  if (!searchResp.ok) {
    const text = await safeText(searchResp);
    throw new Error(
      `Trade search failed: ${searchResp.status} ${searchResp.statusText} :: ${text}`,
    );
  }

  const searchJson = (await searchResp.json()) as {
    id?: string;
    result?: string[];
    total?: number;
  };

  const searchId = searchJson.id;
  const resultIds = searchJson.result || [];

  if (!searchId || resultIds.length === 0) {
    return {
      ok: true,
      league,
      item_name: name,
      cheapest_price: null,
      estimated_price: null,
      sample_size: 0,
      estimate_sample_size: 0,
      estimate_basis: null,
      price_stats: null,
      listings: [],
    };
  }

  const topIds = resultIds.slice(0, 10);

  const fetchUrl = `https://www.pathofexile.com/api/trade2/fetch/${topIds.join(",")}?query=${encodeURIComponent(
    searchId,
  )}&realm=poe2`;

  const fetchResp = await fetch(fetchUrl, {
    method: "GET",
    headers,
  });

  if (!fetchResp.ok) {
    const text = await safeText(fetchResp);
    throw new Error(
      `Trade fetch failed: ${fetchResp.status} ${fetchResp.statusText} :: ${text}`,
    );
  }

  const fetchJson = (await fetchResp.json()) as {
    result?: Array<{
      id?: string;
      listing?: {
        indexed?: string;
        account?: { name?: string };
        price?: {
          type?: string;
          amount?: number | string;
          currency?: string;
        };
      };
    }>;
  };

  const idOrder = new Map<string, number>();
  topIds.forEach((id, idx) => idOrder.set(id, idx));

  const orderedResults = [...(fetchJson.result || [])].sort((a, b) => {
    const aPos = a.id
      ? (idOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    const bPos = b.id
      ? (idOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    return aPos - bPos;
  });

  const listings: Listing[] = orderedResults.map((entry) => {
    const price = entry.listing?.price;
    const numericAmount = toNumber(price?.amount);
    const currency = price?.currency || null;

    return {
      id: entry.id,
      price:
        numericAmount != null && currency
          ? `${formatAmount(numericAmount)} ${currency}`
          : null,
      price_amount: numericAmount,
      price_currency: currency,
      account: entry.listing?.account?.name || null,
      indexed: entry.listing?.indexed || null,
    };
  });

  const cheapestPrice =
    listings.find((listing) => listing.price != null)?.price ?? null;

  const stats = computePriceStats(listings);

  return {
    ok: true,
    league,
    item_name: name,
    cheapest_price: cheapestPrice,
    estimated_price: stats?.estimate_text ?? null,
    sample_size: listings.length,
    estimate_sample_size: stats?.priced_sample_size ?? 0,
    estimate_basis: stats?.estimate_basis ?? null,
    price_stats: stats,
    listings,
  };
}

function formatPricecheckResponse(
  result: PricecheckResponse,
  verbose: boolean,
): Record<string, unknown> {
  if (verbose) {
    return result;
  }

  return {
    ok: result.ok,
    league: result.league,
    item_name: result.item_name,
    estimated_price: result.estimated_price,
  };
}

function buildUniqueSearchBody(name: string) {
  return {
    query: {
      status: { option: "available" },
      name,
      filters: {
        type_filters: {
          disabled: false,
          filters: {
            rarity: {
              option: "unique",
            },
          },
        },
      },
      stats: [
        {
          type: "and",
          filters: [],
          disabled: false,
        },
      ],
    },
    sort: {
      price: "asc",
    },
  };
}

function computePriceStats(listings: Listing[]): PriceStats | null {
  const priced = listings.filter(
    (listing) =>
      listing.price_amount != null &&
      Number.isFinite(listing.price_amount) &&
      !!listing.price_currency,
  );

  if (priced.length === 0) {
    return null;
  }

  const anchorCurrency = priced[0].price_currency!;
  const sameCurrency = priced.filter(
    (listing) => listing.price_currency === anchorCurrency,
  );

  if (sameCurrency.length === 0) {
    return null;
  }

  const amounts = sameCurrency
    .map((listing) => listing.price_amount!)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (amounts.length === 0) {
    return null;
  }

  const min = amounts[0];
  const max = amounts[amounts.length - 1];
  const median = medianOfSorted(amounts);
  const currenciesSeen = Array.from(
    new Set(priced.map((listing) => listing.price_currency!).filter(Boolean)),
  );

  return {
    currency: anchorCurrency,
    min,
    median,
    max,
    estimate_text: `~${formatAmount(median)} ${anchorCurrency}`,
    priced_sample_size: amounts.length,
    estimate_basis: `mid-high estimate from cheapest ${amounts.length} listings (${anchorCurrency} only)`,
    mixed_currencies_in_sample: currenciesSeen.length > 1,
    currencies_seen: currenciesSeen,
  };
}

function medianOfSorted(values: number[]): number {
  const len = values.length;
  if (len === 0) {
    throw new Error("Cannot compute median of empty array");
  }

  const mid = Math.floor(len / 2);
  return values[mid];
}

function withSnapshotMeta(
  result: PricecheckResponse,
  snapshotMeta: SnapshotMeta,
): PricecheckResponse {
  return {
    ...result,
    snapshot_meta: snapshotMeta,
  };
}

function stripSnapshotMeta(result: PricecheckResponse): PricecheckResponse {
  const { snapshot_meta: _snapshotMeta, ...rest } = result;
  return rest;
}

function parseStoredResult(row: SnapshotRow): PricecheckResponse {
  return JSON.parse(row.result_json) as PricecheckResponse;
}

function isFreshSnapshot(row: SnapshotRow, nowIso: string): boolean {
  return Date.parse(row.fresh_until) > Date.parse(nowIso);
}

function getSnapshotTtlHours(env: Env): number {
  const raw = env.PRICE_SNAPSHOT_TTL_HOURS;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return 12;
}

function addHoursIso(iso: string, hours: number): string {
  const date = new Date(iso);
  date.setTime(date.getTime() + hours * 60 * 60 * 1000);
  return date.toISOString();
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toNumber(value: number | string | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatAmount(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2).replace(/\.?0+$/, "");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}
