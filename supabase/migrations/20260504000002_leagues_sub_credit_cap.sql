-- Max points credited to an absent registered player when a sub plays in their place
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS sub_credit_cap integer NOT NULL DEFAULT 7
    CHECK (sub_credit_cap >= 1);
