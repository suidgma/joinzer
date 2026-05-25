-- Add last_login to profiles, synced from auth.users.last_sign_in_at via trigger.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login timestamptz;

-- Back-fill from auth.users for existing rows
UPDATE public.profiles p
SET last_login = u.last_sign_in_at
FROM auth.users u
WHERE u.id = p.id
  AND u.last_sign_in_at IS NOT NULL;

-- Trigger function: fires on auth.users UPDATE when last_sign_in_at changes
CREATE OR REPLACE FUNCTION public.sync_last_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at THEN
    UPDATE public.profiles
    SET last_login = NEW.last_sign_in_at
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_last_login ON auth.users;
CREATE TRIGGER trg_sync_last_login
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_last_login();
