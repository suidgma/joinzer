# Joinzer — Business Model & Pricing

_Last updated: July 17, 2026_

> The **plumbing** below is built and real (🔵 grounded). The **pricing** — fee levels, who pays, subscription vs. transaction — is entirely undecided (❓ open) and unvalidated. Don't let the sophistication of the payment infrastructure be mistaken for a settled business model.

## How money flows today (🔵 grounded — this is shipped)

- **Stripe Checkout** for tournament / league / play-event registration.
- **Stripe Connect Express** onboarding for organizers, so payouts go to *their* bank.
- **Destination charges** with `on_behalf_of` route funds to the organizer's account, with a **platform application fee** taken by Joinzer.
- **Refunds** reverse the transfer and refund the application fee; there's a refund-policy + no-refund-date model.
- **Discount codes, multi-division carts, and early-bird tiered pricing** all exist.
- **Paid-event gate:** creating *free* events is open to everyone; **charging money is gated** behind manual organizer approval (`can_create_paid_events`, "book a call" CTA). This is a deliberate trust/qualification checkpoint.
- **Joinzer moves no prize money.** Prizes are advertised and handed out by organizers; there's no escrow/payout for winnings.

The mechanism for taking a cut of paid events therefore **already exists**. What's missing is the *decision about how much and from whom.*

## Revenue model hypotheses (🟡)

Not mutually exclusive — likely a sequence:

1. **Transaction fee on paid events (primary, near-term).** A % (± fixed) application fee on each paid registration. Infrastructure is live; only the number is unset.
2. **Organizer subscription / SaaS (possible, later).** A monthly fee for organizers who run recurring leagues, in exchange for lower/zero transaction fees or premium tools. Unproven appetite.
3. **Freemium boundary (structural).** Free events and the whole player side stay free; monetization concentrates on paid events and organizer tooling. The paid-event gate is the seam.
4. **Later expansion (speculative):** org/business accounts, sponsorships/advertising in the directory, premium player features. All premature.

## The open pricing questions (❓ — need real input)

1. **What fee?** What % + fixed fee on a paid registration is fair and still competitive with "Venmo + free bracket site = ~0"?
2. **Who bears it?** Organizer absorbs it (cleaner pitch, lower organizer margin) vs. passed to the player as a service fee (organizer keeps full price, player pays more)? This is a positioning decision as much as a pricing one.
3. **Transaction-only vs. subscription?** Do organizers prefer a pure cut (no commitment) or a subscription (predictable, unlocks lower fees)?
4. **Where is the free/paid line?** Free events are free — but do premium organizer tools (CSV import, advanced scheduling, offline mode, analytics) stay free or become paid?
5. **How does Joinzer's take compare** to what a bracket site / registration platform charges today? (Needs competitive fee research — see `market-and-competitive.md`.)

## Unit-economics sketch (🟡 — placeholder, needs real numbers)

The honest version: **we don't have real numbers.** To fill in later, capture per organizer/event:
- Avg. registrations per event × avg. price × take rate = revenue per event.
- Stripe processing cost (~2.9% + 30¢) — note this is *separate from* Joinzer's application fee and eats into economics.
- Acquisition cost per organizer (early: mostly Marty's time / concierge).
- Organizer retention (events per organizer per year) — the real driver of LTV.

Until an organizer runs a real paid event, treat all of these as blanks to fill, not estimates to trust.

## Monetization sequencing (🟡)

**Land free → monetize paid events → (maybe) add an organizer subscription / org layer.** Don't gate acquisition behind payment; use free events to get organizers and players in, and let the paid-event fee be the natural first revenue. The paid-event approval gate already enforces a human touchpoint (the "book a call"), which doubles as qualification and a pricing conversation.

## What to validate first

- Would the first organizer run a **paid** event on Joinzer, and at what fee — absorbed or passed to players?
- Is a subscription even interesting to them, or is transaction-only strictly preferred?
- What are competing platforms actually charging in this market?
