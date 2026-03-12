CREATE TABLE IF NOT EXISTS item_price_snapshots (
  league_norm TEXT NOT NULL,
  item_name_norm TEXT NOT NULL,
  league TEXT NOT NULL,
  item_name TEXT NOT NULL,
  estimated_price TEXT,
  result_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  fresh_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (league_norm, item_name_norm)
);
