# Joinzer — First-Organizer Outreach Kit

_Last updated: July 17, 2026_

> A working playbook for landing the first organizer — the #1 blocker (see `go-to-market.md` and `open-decisions.md`). This is an **action tool**, not a knowledge doc. Use it, mark it up, and feed what you learn back into `user-research.md`.
>
> **Honesty stance (important):** you have no traction yet, and that's fine — do not fake it. The winning frame is *"be my founding organizer — I'll personally set up and run your next event for free."* Exclusivity + high-touch beats fake social proof, and it's true.

---

## 1. Who to approach (target-list framework)

You don't need a big list. You need **5–10 well-chosen organizers** and one yes. Quality over volume.

### Where Vegas organizers cluster (🟡 — validate locally, pull real venues from the ~65 courts already in the DB)

- **Active-adult / 55+ communities** — Sun City Summerlin, Sun City Anthem, Del Webb, Solera, etc. Pickleball is enormous here and someone *runs* the ladders/leagues. **Strong hypothesis for the beachhead** — high volume, recurring play, real organizers, often stuck on spreadsheets.
- **City Parks & Rec pickleball programs** — Henderson, Las Vegas, North Las Vegas rec departments run organized play and leagues.
- **Private clubs / racquet & fitness clubs** — Life Time, local racquet clubs with pickleball programming.
- **Local tournament directors** — people already running paid events (they've felt the registration/payment pain most).
- **Facebook groups** — Las Vegas / Henderson / Summerlin pickleball groups; the admins and the people posting "who's in for Tuesday?" are your organizers.
- **DUPR-listed local leagues/clubs** — anyone already running rated play.

### Rank each prospect (score 1–5, add them up)

| Signal | 1 (low) → 5 (high) |
|---|---|
| **Pain** — how manual/chaotic is their current setup? | spreadsheet + group text + Venmo = 5 |
| **Volume** — how many players do they touch? | more players = more value from one yes |
| **Recurring** — do they run leagues/ladders on a schedule (vs. one-offs)? | recurring = 5 |
| **Money** — do they already collect fees? | yes = 5 (payments is a killer feature) |
| **Reachability** — do you have a warm intro or an easy in-person path? | warm intro = 5 |
| **Openness** — do they seem tech-comfortable / frustrated enough to try something? | frustrated + curious = 5 |

Approach the top of the list first. A high-**pain**, high-**volume**, **recurring**, fee-collecting organizer you can reach warmly is the dream first customer.

### Target list (fill in)

| Name | What they run | Where / how to reach | Score | Warm intro? | Status |
|---|---|---|---|---|---|
| | | | | | |

---

## 2. The offer (the founding-organizer pilot)

The whole pitch in one line: **"Let me set up and run your next event on Joinzer — for free — and you tell me if it made your life easier."**

**What you give:**
- You (Marty) personally set up their league/tournament in Joinzer.
- Zero platform fees for the pilot event.
- You're there — in person or on call — on event day so nothing breaks on them.
- Their players get free profiles + a rating that follows them.

**What you ask in return:**
- They run *one* real event on it.
- 30 minutes of honest feedback afterward.
- If they love it, a conversation about what's fair going forward (and an intro to another organizer).

**Why it works:** it removes every reason to say no — no cost, no setup work, no risk of looking bad in front of their players, no lock-in. You're absorbing all the risk because the learning is worth more to you than the effort.

---

## 3. Cold outreach messages

Keep them short. Lead with *their* benefit, not your product. Be a real person.

### Text / DM (shortest — best for FB or a number)

> Hey [Name] — I saw you run [the Tuesday ladder / the Henderson league]. I built a pickleball app that handles the roster, scheduling, scoring, standings, and payments in one place, and I'm looking for **one local organizer to be my first**. I'll set it up and run your next event for free — you just tell me if it made things easier. Worth a quick look?

### Email (a little more room)

> **Subject: run your next [league/tournament] without the spreadsheet?**
>
> Hi [Name],
>
> I'm Marty — I'm based here in the [Vegas/Henderson] area and I built **Joinzer**, an app that runs pickleball leagues and tournaments end to end: rosters, scheduling, live scoring, standings, subs, and payments (with payouts straight to you), all in one place.
>
> I'm not asking you to switch everything. I'm looking for **one founding organizer** to run a single event on it — and I'll do the setup and be there on event day myself, free. In exchange I'd just want your honest take.
>
> Could I show you a 10-minute demo this week? If it's not obviously easier than what you do now, I'll get out of your hair.
>
> Thanks,
> Marty
> [phone / link]

### In person, at the courts (opener)

> "Hey — are you the one who organizes [the league] here? … I actually built an app that runs all the roster/scoring/payment stuff for leagues, and I'm looking for one local organizer to be my first. Can I set up and run your next one for free and get your honest feedback?"

### Warm-intro / referral ask (to your network)

> "Quick ask — do you know anyone who *runs* pickleball leagues, ladders, or tournaments around town? I built a tool for exactly that and I'm looking for one organizer to pilot it with, free. An intro would mean a lot."

---

## 4. The demo & discovery conversation

The demo's job is to make them think *"this would save me hours."* The conversation's job is to **learn** — you're validating the entire strategy folder in this meeting.

**Demo flow (keep it under 15 min):** create a league → add players (show CSV import) → run a session (generate rounds, score a match live) → show standings updating → show taking a payment + the payout going to *them*. Use seeded data so brackets/standings look full, not empty.

> **Ready-made demo environment:** run `node scripts/seed-demo.mjs` from the repo root. It creates a clean, professional demo set — a demo organizer, 20 realistic players, a mid-season round-robin league (live standings) and an in-progress single-elim tournament (bracket with round 1 done, semis set) — clearly separated from test junk. Log in as the demo organizer (credentials print when the script runs) to show the organizer side; log in as any player to show the player side. Re-run anytime to reset it clean; `--reset` tears it down. Use this so the "here's it running" moment looks real.

**Then shut up and ask** (natural version of `customers-and-personas.md`'s validation questions — capture answers in `user-research.md`):
1. Walk me through how you run your events today — where does it hurt most?
2. How do you handle money — fees, refunds, paying yourself?
3. How do you deal with no-shows and subs?
4. What would have to be true for you to run your *next* event on this?
5. Who should pay a small platform fee — you or your players? What'd feel fair?
6. What do your players complain about?
7. What's the one thing that, if it broke on event day, would kill it for you?

Every answer sharpens the beachhead persona, the pricing, and the Path A/B call.

---

## 5. Objection handling

- **"I already use [CourtReserve / PickleballBrackets / a spreadsheet / GroupMe]."** → "Totally — I'm not asking you to rip anything out. Run *one* event on Joinzer so you've got a real comparison. Free, and I do the work. If yours is better, you've lost nothing."
- **"I don't have time to learn a new tool."** → "That's exactly why I do the setup and run it with you. Your job doesn't change — mine does."
- **"What does it cost? What's the catch?"** → "Nothing for your first event. I'm building this and your feedback is worth more to me than a fee right now. If you love it, we'll talk about what's fair — you'll never be surprised by a charge."
- **"My players won't want another app."** → "They don't need to do anything heavy to start — and they get a profile and a rating that actually follows them from league to league. That tends to be a pull, not a chore."
- **"Who are you / is this legit?"** → "Solo founder, I built it, I'm local, and I'll be standing next to you on event day. Here's it running live — [link]."
- **"Come back when it's more established."** → "Fair — but being first means I build around *your* needs and you get me personally. That deal goes away once there's a waitlist."

---

## 6. Follow-up cadence

- **Day 0:** send the message.
- **No reply by ~day 4–5:** one short bump — offer something smaller. *"No worries if now's not the time — want me to just send a 2-minute video of it running? No meeting needed."*
- **Still nothing:** leave it, move down the list. Don't chase past two touches — a founding organizer should feel a *little* pull, not be dragged.
- **On a yes:** lock a specific event and date immediately. Vague interest that isn't tied to a real event on the calendar isn't a yes.

---

## 7. What "success" looks like

The pilot worked if, unprompted, the organizer says **they'd run their next event on Joinzer** — ideally that they'd pay for it, and ideally with an intro to another organizer. That's the moment the business becomes real and half of `docs/strategy/` graduates from 🟡 hypothesis to ✅ validated.

**One-page pitch (draft — can become a shareable web page):**

> **Run your pickleball league or tournament without the spreadsheet.**
> Joinzer handles rosters, scheduling, live scoring, standings, subs, and payments — with payouts straight to you — in one app, on your phone.
> **Founding-organizer offer:** I'll set up and run your next event for free, and be there on event day. You keep it if it makes your life easier.
> — Marty, founder · [contact] · [link]

---

## Notes to self

- Track every contact in the target-list table and every conversation in `user-research.md`.
- The goal of the first 5–10 conversations is **one committed event** *and* the answers that resolve `open-decisions.md`. Both matter.
- If nobody bites, that's a finding, not a failure — it means the offer, the target, or the value prop needs to change. Update the strategy docs accordingly.
