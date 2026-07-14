-- Enable refunds on paid event participation (leave within the refund window, or
-- organizer cancellation), for parity with tournament_registrations /
-- league_registrations.

-- Track when a participant was refunded.
alter table public.event_participants add column if not exists refunded_at timestamptz;

-- Allow 'refunded' as a payment_status (the existing CHECK excluded it).
alter table public.event_participants drop constraint if exists event_participants_payment_status_check;
alter table public.event_participants add constraint event_participants_payment_status_check
  check (payment_status = any (array['free','unpaid','paid','waived','refunded']));
