-- Email log: records every transactional email sent via Resend.
-- Visible to service role only (internal ops tooling).

CREATE TABLE email_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  recipient_email text        NOT NULL,
  subject        text        NOT NULL,
  resend_id      text,
  status         text        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error          text
);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

-- No access via anon or authenticated role — service role only.
CREATE POLICY "no public access" ON email_log FOR ALL USING (false);

CREATE INDEX email_log_created_at_idx ON email_log (created_at DESC);
CREATE INDEX email_log_recipient_idx  ON email_log (recipient_email);
