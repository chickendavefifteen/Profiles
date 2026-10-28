# Memory index (small by design)

Bounded recall: the agent reads this file, then pulls one note at a time.
Nothing here is a transcript. Promote only verified, durable facts.

## Facts (synthetic demo)

- Demo user prefers Lite in the morning, Focus after lunch. (demo fiction)
- Checkpoint format: `## checkpoint <task-id> — <device> <iso-time>`.

## Pointers

- `../tasks/ledger.json` — task states + next steps.
- `../notes/welcome.md` — starter note.
- `../calendar/demo-week.json` — synthetic events.
