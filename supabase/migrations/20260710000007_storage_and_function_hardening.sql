-- Security hardening (low-severity advisor items).

-- 1) avatars bucket is public, so object URLs are served via the bucket's public flag —
-- the broad "Avatars are publicly readable" SELECT policy on storage.objects isn't needed
-- for that and only lets clients LIST every file (enumerate the {userId}/avatar paths).
-- The app uses upload + getPublicUrl only (no list/download), and the upload/update-own
-- policies + public URL access are untouched, so drop the listing policy.
drop policy if exists "Avatars are publicly readable" on storage.objects;

-- 2) Pin the mutable search_path on these functions (advisor: function_search_path_mutable).
-- Bodies use unqualified public references, so pin to public rather than '' to avoid breakage.
alter function public.update_updated_at_column() set search_path = public;
alter function public.increment_discount_uses(uuid) set search_path = public;
alter function public.pair_solo_registrations(uuid, uuid) set search_path = public;
