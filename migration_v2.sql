-- Honey App Phase 2 migration
-- Paste this entire block into Supabase Studio > SQL Editor and click Run.
-- Safe to run multiple times (uses IF NOT EXISTS / DROP IF EXISTS / OR REPLACE).

-- 1. Add 'in_process' status (allows operator to claim an order before pouring)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'in_process', 'done', 'cancelled'));

-- 2. Add done_at for fulfillment time tracking (used by analytics)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS done_at timestamptz;

-- 3. Auto-set done_at when an order transitions to 'done'
CREATE OR REPLACE FUNCTION set_done_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.done_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_done_at ON orders;
CREATE TRIGGER trg_set_done_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_done_at();

-- 4. Stock table: operator-managed count of pre-poured bottles per SKU
CREATE TABLE IF NOT EXISTS stock (
  product_id int PRIMARY KEY REFERENCES products(id),
  ready_count int NOT NULL DEFAULT 0 CHECK (ready_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed one row per product (idempotent)
INSERT INTO stock (product_id)
SELECT id FROM products
ON CONFLICT (product_id) DO NOTHING;

-- 5. RLS: operator only (anon has no access to stock)
ALTER TABLE stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_all_stock ON stock;
CREATE POLICY auth_all_stock ON stock FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. Auto-update stock.updated_at on change
CREATE OR REPLACE FUNCTION update_stock_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_stock_updated_at ON stock;
CREATE TRIGGER trg_stock_updated_at
  BEFORE UPDATE ON stock
  FOR EACH ROW EXECUTE FUNCTION update_stock_updated_at();
