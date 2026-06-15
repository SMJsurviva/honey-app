-- Honey App schema — complete target state as of Phase 2
-- Run migration_v2.sql in Supabase Studio to apply Phase 2 changes to existing DB.

CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  honey_type text NOT NULL,
  size_g int NOT NULL,
  display_label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  UNIQUE (honey_type, size_g)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,                              -- set by trigger when status → done
  device_id uuid NOT NULL,
  requester_name text,
  product_id int NOT NULL REFERENCES products(id),
  quantity int NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 9999),
  urgent boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_process', 'done', 'cancelled')),
  dismissed boolean NOT NULL DEFAULT false,         -- operator cleared a cancelled order
  verbal boolean NOT NULL DEFAULT false             -- entered manually by operator
);

CREATE TABLE IF NOT EXISTS operator_subscriptions (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  subscription jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS stock (
  product_id int PRIMARY KEY REFERENCES products(id),
  ready_count int NOT NULL DEFAULT 0 CHECK (ready_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock ENABLE ROW LEVEL SECURITY;

-- Anon (monks): read products, place orders, read orders
CREATE POLICY anon_read_products ON products FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_orders   ON orders   FOR SELECT TO anon USING (true);
CREATE POLICY anon_insert_orders ON orders   FOR INSERT TO anon
  WITH CHECK (status = 'pending' AND dismissed = false AND verbal = false);

-- Operator (authenticated): full access
CREATE POLICY auth_all_products ON products             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_orders   ON orders               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_subs     ON operator_subscriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_stock    ON stock                FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Own-order cancellation RPC (device_id enforced server-side)
CREATE OR REPLACE FUNCTION cancel_order(p_order_id uuid, p_device_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE orders
     SET status = 'cancelled'
   WHERE id = p_order_id
     AND device_id = p_device_id
     AND status = 'pending';
  RETURN found;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_order(uuid, uuid) TO anon, authenticated;

-- Trigger: set done_at when order status → done
CREATE OR REPLACE FUNCTION set_done_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.done_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_done_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_done_at();

-- Trigger: update stock.updated_at on change
CREATE OR REPLACE FUNCTION update_stock_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_stock_updated_at
  BEFORE UPDATE ON stock
  FOR EACH ROW EXECUTE FUNCTION update_stock_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

-- Seed: 4 types x 5 sizes. 벌꿀 first; 470g is the flagship. 2.4kg = bulk.
INSERT INTO products (honey_type, size_g, display_label, sort) VALUES
  ('벌꿀',   350,  '벌꿀 350g',   10),
  ('벌꿀',   470,  '벌꿀 470g',   11),
  ('벌꿀',   500,  '벌꿀 500g',   12),
  ('벌꿀',   700,  '벌꿀 700g',   13),
  ('벌꿀',   2400, '벌꿀 2.4kg',  14),
  ('야생화', 350,  '야생화 350g', 20),
  ('야생화', 470,  '야생화 470g', 21),
  ('야생화', 500,  '야생화 500g', 22),
  ('야생화', 700,  '야생화 700g', 23),
  ('야생화', 2400, '야생화 2.4kg',24),
  ('대죽꿀', 350,  '대죽꿀 350g', 30),
  ('대죽꿀', 470,  '대죽꿀 470g', 31),
  ('대죽꿀', 500,  '대죽꿀 500g', 32),
  ('대죽꿀', 700,  '대죽꿀 700g', 33),
  ('대죽꿀', 2400, '대죽꿀 2.4kg',34),
  ('감로꿀', 350,  '감로꿀 350g', 40),
  ('감로꿀', 470,  '감로꿀 470g', 41),
  ('감로꿀', 500,  '감로꿀 500g', 42),
  ('감로꿀', 700,  '감로꿀 700g', 43),
  ('감로꿀', 2400, '감로꿀 2.4kg',44)
ON CONFLICT (honey_type, size_g) DO NOTHING;

-- Seed stock
INSERT INTO stock (product_id)
SELECT id FROM products
ON CONFLICT (product_id) DO NOTHING;
