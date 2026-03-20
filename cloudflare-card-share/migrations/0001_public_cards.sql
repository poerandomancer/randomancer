CREATE TABLE IF NOT EXISTS public_cards (
  slug TEXT PRIMARY KEY,
  snapshot_hash TEXT NOT NULL UNIQUE,
  card_kind TEXT NOT NULL CHECK(card_kind IN ('build', 'challenge')),
  schema_version TEXT NOT NULL,
  app_version TEXT,
  payload_json TEXT NOT NULL,
  preview_title TEXT NOT NULL,
  preview_subtitle TEXT,
  preview_description TEXT NOT NULL,
  preview_image_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_cards_kind_created_at
  ON public_cards (card_kind, created_at DESC);
