ALTER TABLE public.profiles
  ADD COLUMN email_visibility TEXT NOT NULL DEFAULT 'self'
    CHECK (email_visibility IN ('self', 'captains', 'all')),
  ADD COLUMN phone_visibility TEXT NOT NULL DEFAULT 'self'
    CHECK (phone_visibility IN ('self', 'captains', 'all'));
