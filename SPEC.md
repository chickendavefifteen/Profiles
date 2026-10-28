# Profiles — Hackathon Spec (draft v1, 2026-10-26)

One line: every app forces you to adapt to it. Profiles adapts to you.
One press (or one voice note) reshapes your whole digital environment to
your device, your energy, and your brain.

Event: Meta Global AI Developer Hackathon, Indie track (solo).
Deadline: Nov 4, 2026, 9:00 PM ET.
Theme: Build for Your World.

## What Profiles is

A local-first personal environment (Tauri desktop app + phone PWA) built
around declarative "profile packs". A profile pack is a small JSON file
that describes a whole mode of working/living:

- ui: density, font scale, target size, palette, animation level
- sensory_budget: max animation intensity, flash rate, simultaneous motion.
  Enforced by a "sensory governor", not just a theme.
- input: typing/click, a few keybinds, voice, switch-style big targets
- notifications: what may interrupt, and when
- agent: verbosity, proactivity, parallelism (1 task vs many),
  autonomy (suggest-only vs act-with-checkpoint), rest reminders
- widgets: which of calendar / notes / news / files / tasks are visible

Built-in packs: Lite (Chromebook, kids, family), Chill, Focus/Serious,
Dev/Heavy, Low-Sensory. Users can edit and share packs.

## Agent core (Pi-style loop)

Profiles is powered by a durable agent loop, in the spirit of Pi +
pi-durable-vault:

  sense -> plan -> act -> verify -> remember -> (checkpoint / handoff)

- Local vault: notes, tasks, calendar, files and agent memory live in a
  plain local folder the user owns. Memory index is small; recall is
  bounded and on demand.
- Task ledger: every agent task has a state, a next step, and a
  checkpoint, so work survives device switches and app restarts.
  Pick up on the phone exactly where the desktop left off.
- Adjustable per profile: loop cadence (how often it checks in),
  autonomy, parallelism, which tools it may use, how it asks permission.
  Lite = one thing, slowly, always asks. Dev = parallel, proactive,
  still checkpointed before anything irreversible.
- The agent can suggest a profile switch ("you seem tired -> Chill?")
  but never switches without the user saying yes. Every suggestion
  carries a "why".

Example flow: voice note or photo of a letter -> agent turns it into a
calendar entry + note + task, filed in the vault -> user picks it up
later on a different device, in a different mode.

## Models

- Build/integration model for this project: Muse Spark 1.3 Contributor,
  xhigh (see model plan below). Runtime agent: same.
- Smart model routing ("let each mode pick its model") is a FEATURE,
  NOT a default: an opt-in toggle, OFF by default.
  - Off: one fixed model for everything. Simple, predictable cost.
  - On: profiles may suggest/route to different models (e.g. fast/cheap
    for Lite, deeper for Dev), always with a cost preview, a monthly
    budget cap, and an on-screen cost meter. No silent switching.
  Rationale: model choice can be an accessibility feature (simple, fast
  answers vs deep reasoning), but it massively affects cost, so the
  user opts in knowingly.
- Privacy note: Contributor tier lets Meta train on prompts. Demo uses
  synthetic data only; the spec flags this in-app, and a Standard-mode
  option is listed as post-hackathon work.

## Accessibility commitments

- Sensory governor enforces animation/flash budgets in code, provable
  on camera: switch to Low-Sensory and motion actually stops.
- Full keyboard-only and voice-only paths; big-target mode.
- Cognitive load controls: one-thing mode, reduced parallelism,
  plain-language agent verbosity settings.
- Works lite on low hardware (Chromebook) and richer where resources
  allow (desktop animated frontend, still profile-governed).

## Demo script (target 2-3 min)

1. Chromebook, Lite mode: one big button, one voice note captures a task.
2. Desktop, Dev/Heavy: same task picked up mid-flight by the agent loop,
   animated frontend, parallel work, checkpoint shown.
3. One press -> Low-Sensory: animation stops, palette calms, agent goes
   terse and mono-task. Sensory budget meter visible.
4. Agent suggests Chill + rest; user accepts; notifications pause.
5. Phone PWA: the day's summary, readable in any mode.

## Non-goals / conflict safety

- General personal productivity only: no games, no employer data
  pipelines, no employer code, accounts or data. Clean-room, personal,
  synthetic demo data. (Submission must be solely owned; organisers
  get a broad licence and nothing shared is confidential.)

## 9-day rough plan

- D1-2: Tauri shell + profile engine + vault/ledger skeleton
- D3-4: agent loop actions (capture -> task/calendar/note), checkpoints
- D5: phone PWA pickup + profile sync
- D6: sensory governor + accessibility presets
- D7: Dev/Heavy animated frontend, smart-routing toggle (opt-in) + cost meter
- D8: demo video, submission text
- D9: buffer, submit early

## Model plan (team)

- Spec/planning (now): Muse Wonder, this session.
- Build + integration sessions: Muse Spark 1.3 Contributor, xhigh.
  Never plain muse-spark-1.3 (standing owner directive 2026-10-11).
- If a future session starts on Wonder or normal Spark, switch first.

## Discord landscape (sampled 2026-10-26 evening)

Read under Dave's explicit bounded permission (amended rule 2026-10-26),
screenshots in profiles-hackathon/discord-look/.

- Channels checked: build-for-your-world, push-the-frontier, intros
  (still mostly intros/chatter on day 1, 1,500+ builders).
- Concrete proposals seen: Ankita (desktop AI companion doing jobs in
  the background), immersive music-generation AI, Lumio AI (learn to
  build AI), farming weather advice, materials agent (Muse Spark Open),
  events platform, code-security agent.
- Nearest neighbour remains Ankita-style desktop companions and the
  public-GitHub Auren "one agent across devices". Neither does modes,
  accessibility profiles, or sensory budgets.
- No proposal found for accessibility modes, neurodivergent sensory
  control, mood/energy modes, or cross-device profile packs.
  Profiles' lane looks empty.

## Open questions

- Discord landscape check (Dave to paste/screenshot, or bounded browse
  with his explicit named permission under amended rule 2026-10-26).
- Employer IP/moonlighting clause check before submitting.
