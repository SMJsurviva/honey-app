-- Honey App schema — run once in Supabase SQL editor (or via Management API)

create table if not exists products (
  id serial primary key,
  honey_type text not null,
  size_g int not null,
  display_label text not null,
  active boolean not null default true,
  sort int not null default 0,
  unique (honey_type, size_g)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  device_id uuid not null,
  requester_name text,
  product_id int not null references products(id),
  quantity int not null default 1 check (quantity >= 1 and quantity <= 9999),
  urgent boolean not null default false,
  status text not null default 'pending' check (status in ('pending','done','cancelled')),
  dismissed boolean not null default false,  -- operator cleared a cancelled order from the queue
  verbal boolean not null default false      -- entered manually by operator
);

create table if not exists operator_subscriptions (
  id serial primary key,
  created_at timestamptz not null default now(),
  subscription jsonb not null
);

alter table products enable row level security;
alter table orders enable row level security;
alter table operator_subscriptions enable row level security;

-- Monks (anon role): read products, place orders, read orders.
-- Cancellation goes through the cancel_order() RPC so device_id ownership
-- is enforced server-side — anon has no direct UPDATE/DELETE.
create policy anon_read_products on products for select to anon using (true);
create policy anon_read_orders   on orders   for select to anon using (true);
create policy anon_insert_orders on orders   for insert to anon
  with check (status = 'pending' and dismissed = false and verbal = false);

-- Operator (authenticated role): full access.
create policy auth_all_products on products for all to authenticated using (true) with check (true);
create policy auth_all_orders   on orders   for all to authenticated using (true) with check (true);
create policy auth_all_subs     on operator_subscriptions for all to authenticated using (true) with check (true);

-- Own-order cancellation, enforceable because device_id lives on the row.
create or replace function cancel_order(p_order_id uuid, p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update orders
     set status = 'cancelled'
   where id = p_order_id
     and device_id = p_device_id
     and status = 'pending';
  return found;
end;
$$;

grant execute on function cancel_order(uuid, uuid) to anon, authenticated;

-- Realtime for the operator queue
alter publication supabase_realtime add table orders;

-- Seed: 4 types x 4 sizes. 벌꿀 first; 470g is the flagship size.
insert into products (honey_type, size_g, display_label, sort) values
  ('벌꿀',   350, '벌꿀 350g',   10),
  ('벌꿀',   470, '벌꿀 470g',   11),
  ('벌꿀',   500, '벌꿀 500g',   12),
  ('벌꿀',   700, '벌꿀 700g',   13),
  ('야생화', 350, '야생화 350g', 20),
  ('야생화', 470, '야생화 470g', 21),
  ('야생화', 500, '야생화 500g', 22),
  ('야생화', 700, '야생화 700g', 23),
  ('대죽꿀', 350, '대죽꿀 350g', 30),
  ('대죽꿀', 470, '대죽꿀 470g', 31),
  ('대죽꿀', 500, '대죽꿀 500g', 32),
  ('대죽꿀', 700, '대죽꿀 700g', 33),
  ('감로꿀', 350, '감로꿀 350g', 40),
  ('감로꿀', 470, '감로꿀 470g', 41),
  ('감로꿀', 500, '감로꿀 500g', 42),
  ('감로꿀', 700, '감로꿀 700g', 43)
on conflict (honey_type, size_g) do nothing;
