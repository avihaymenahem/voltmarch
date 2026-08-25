CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('hero', 'footer', 'site'))
);

CREATE INDEX IF NOT EXISTS subscribers_created_at ON subscribers(created_at DESC);
