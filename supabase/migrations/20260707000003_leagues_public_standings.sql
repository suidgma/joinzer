-- Opt-in flag: when true, a read-only, PII-masked public standings page is
-- available at /l/[id]. Default off — organizers choose to share. Additive.
-- Applied to prod via MCP.
alter table leagues add column if not exists public_standings boolean not null default false;
