-- Roadmap #9, Store / E-Commerce. Real catalog + cart + order flow, but
-- checkout does NOT process a real payment yet — no payment processor is
-- connected (product decision: "we will connect the payment later"). An
-- order lands as 'pending_payment' and staff arranges payment out-of-band
-- (bank transfer / cash / whatever the club already uses), then marks it
-- paid manually. Swapping in a real processor later only needs to touch
-- the checkout endpoint that creates the order — this schema doesn't change.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS store_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_he TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_he TEXT,
  description_en TEXT,
  price NUMERIC NOT NULL CHECK (price >= 0),   -- ILS
  image_url TEXT,
  sizes TEXT[],                                 -- NULL/empty = no size variants (e.g. a mug)
  stock INT,                                     -- NULL = not tracked (unlimited)
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES athletes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'fulfilled', 'cancelled')),
  total NUMERIC NOT NULL CHECK (total >= 0),
  contact_phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_orders_athlete ON store_orders (athlete_id, created_at DESC);

-- Line items snapshot product name/price at purchase time — a later edit or
-- removal of the product must never rewrite history on a past order.
CREATE TABLE IF NOT EXISTS store_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES store_products(id) ON DELETE SET NULL,
  product_name_he TEXT NOT NULL,
  product_name_en TEXT NOT NULL,
  size TEXT,
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_store_order_items_order ON store_order_items (order_id);

ALTER TABLE store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages store products" ON store_products;
CREATE POLICY "Service role manages store products"
  ON store_products FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages store orders" ON store_orders;
CREATE POLICY "Service role manages store orders"
  ON store_orders FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages store order items" ON store_order_items;
CREATE POLICY "Service role manages store order items"
  ON store_order_items FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Same recipe as badge-icons: public read, writes only through the
-- service-role admin API route.
INSERT INTO storage.buckets (id, name, public)
VALUES ('store-products', 'store-products', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read access for store product images') THEN
    CREATE POLICY "Public read access for store product images"
      ON storage.objects FOR SELECT USING (bucket_id = 'store-products');
  END IF;
END $$;
