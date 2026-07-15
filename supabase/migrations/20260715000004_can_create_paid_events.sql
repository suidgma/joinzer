-- Gate paid-event creation / payouts behind organizer approval ("book a call"). Free events
-- stay open to everyone; only charging money requires this flag. Grandfather anyone who already
-- connected Stripe so no existing setup breaks.
alter table profiles add column if not exists can_create_paid_events boolean not null default false;

update profiles set can_create_paid_events = true
where stripe_charges_enabled = true
   or id = 'dda69b20-8d97-4c9f-b313-3ba405a50bd0'; -- Marty (platform owner)

comment on column profiles.can_create_paid_events is
  'Organizer approved to create paid events / receive payouts (gated behind a book-a-call). Default false; free events are open to all.';
