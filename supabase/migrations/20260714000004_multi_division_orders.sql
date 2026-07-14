-- Multi-division cart (Phase 5a). An order groups several division registrations
-- under one payment so a bundle discount can apply to the total. RLS deny-all —
-- these are written only by server/service-role code (the route is the auth boundary).

create table if not exists public.tournament_orders (
  id                        uuid primary key default gen_random_uuid(),
  tournament_id             uuid not null references public.tournaments(id) on delete cascade,
  user_id                   uuid not null references public.profiles(id),
  status                    text not null default 'pending'
                              check (status in ('pending','paid','cancelled','expired')),
  subtotal_cents            int not null default 0,
  multi_div_discount_cents  int not null default 0,
  code_discount_cents       int not null default 0,
  total_cents               int not null default 0,
  discount_code_id          uuid,
  stripe_session_id         text,
  stripe_payment_intent_id  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
alter table public.tournament_orders enable row level security;

create table if not exists public.tournament_order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.tournament_orders(id) on delete cascade,
  division_id      uuid not null references public.tournament_divisions(id) on delete cascade,
  registration_id  uuid references public.tournament_registrations(id) on delete set null,
  base_cents       int not null default 0,   -- price before discounts
  net_cents        int not null default 0,   -- allocated share of total (for refunds)
  outcome          text,                      -- 'registered' | 'waitlisted' | null (pending)
  created_at       timestamptz not null default now()
);
alter table public.tournament_order_items enable row level security;

create index if not exists idx_tournament_orders_tournament on public.tournament_orders(tournament_id);
create index if not exists idx_tournament_orders_status on public.tournament_orders(status);
create index if not exists idx_tournament_order_items_order on public.tournament_order_items(order_id);

-- Organizer-configured bundle discount: { type, value, min_divisions }.
alter table public.tournaments add column if not exists multi_division_discount jsonb;
