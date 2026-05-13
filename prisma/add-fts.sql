-- Full-text search setup using PostgreSQL tsvector.
-- Run this ONCE against your database after `prisma db push`:
--
--   psql $DATABASE_URL -f prisma/add-fts.sql
--
-- Or via Prisma:
--   npx prisma db execute --file prisma/add-fts.sql --schema prisma/schema.prisma

-- ── Page: stored tsvector on title ──────────────────────────────────────────

ALTER TABLE "Page"
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Trigger function: recompute search_vector on every title change
CREATE OR REPLACE FUNCTION page_search_vector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    to_tsvector('english', coalesce(NEW.title, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_page_search_vector ON "Page";
CREATE TRIGGER trg_page_search_vector
  BEFORE INSERT OR UPDATE OF title
  ON "Page"
  FOR EACH ROW EXECUTE FUNCTION page_search_vector_update();

-- Backfill existing rows
UPDATE "Page"
  SET search_vector = to_tsvector('english', coalesce(title, ''));

-- GIN index for fast @@ queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_page_search_vector
  ON "Page" USING GIN (search_vector);

-- ── Block: stored tsvector on content (JSON cast to text) ───────────────────
-- Note: this indexes the raw JSON text, which is sufficient for finding
-- text inside TipTap nodes. A future improvement is a dedicated extractor
-- function that traverses the JSON tree.

ALTER TABLE "Block"
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION block_search_vector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    to_tsvector('english', coalesce(cast(NEW.content AS text), ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_search_vector ON "Block";
CREATE TRIGGER trg_block_search_vector
  BEFORE INSERT OR UPDATE OF content
  ON "Block"
  FOR EACH ROW EXECUTE FUNCTION block_search_vector_update();

-- Backfill existing rows
UPDATE "Block"
  SET search_vector = to_tsvector('english', coalesce(cast(content AS text), ''));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_block_search_vector
  ON "Block" USING GIN (search_vector);
