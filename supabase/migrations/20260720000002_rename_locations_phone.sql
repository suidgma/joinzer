-- Session 1 (directory): normalize the capitalized quoted identifier locations."Phone" to phone.
-- Zero code references exist (verified by full-codebase sweep), so this is migration-only.
alter table public.locations rename column "Phone" to phone;
