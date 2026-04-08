CREATE TABLE IF NOT EXISTS card_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_card_slug TEXT NOT NULL,
  reactor_hash TEXT NOT NULL,
  reaction_type TEXT NOT NULL CHECK (
    reaction_type IN ('fire', 'cursed', 'big_brain', 'chaotic')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (public_card_slug, reactor_hash)
);

CREATE INDEX IF NOT EXISTS idx_card_reactions_slug
  ON card_reactions(public_card_slug);
