-- Add enriched metadata columns to locations
alter table locations
  add column if not exists address   text,
  add column if not exists city      text,
  add column if not exists category  text,
  add column if not exists source_url text;
