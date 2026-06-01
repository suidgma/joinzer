alter table profiles
  add column if not exists push_subscription jsonb;
