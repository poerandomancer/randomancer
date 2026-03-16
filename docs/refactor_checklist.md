# Randomancer Refactor Regression Checklist

Run through each item manually after changes. Do not skip.

1) **Load page**
- App loads directly (no intro overlay).
- No console errors.

2) **Roll**
- “Roll Your Fate” works on first click.
- Build output appears; no missing section rendering.

3) **Cohesion slider**
- Slider moves without errors.
- Changing cohesion influences *subsequent* rolls (sanity-check by rolling a few times at low vs high cohesion).

4) **Bind the Fates**
- Modal opens/closes.
- Clicking an option cycles: Oath → Abomination → Clear.
- Clear-all works.
- Changes affect subsequent rolls.

5) **Weapon Set II toggle**
- Toggle ON + roll → Weapon Set II line appears and Skills Tab II is available.
- Toggle OFF + roll → no Weapon Set II line; Tab II disabled/hidden.

6) **Combat Mechanics control (1–3)**
- Control cycles 1 / 2 / 3.
- Roll reflects the selected count (ailments + tactics density).

7) **Summary view**
- Toggle detailed/summary works.
- Summary updates after each roll (no stale view).

8) **Saved builds / build codes**
- Save adds to list (keeps last 10).
- Load from a saved build/build code renders the build correctly.
- Loading a build does **not** change control states (cohesion, mechanics, WS2 toggle, bind-fates settings).

9) **Uniques**
- Uniques render after roll.
- No console errors during unique refresh.

10) **Info & Feedback**
- Info opens/closes.
- Feedback opens link.
- Mobile menu opens/closes and triggers items correctly.


11) **Tag normalization guardrails**
- Run `python data/helperScripts/generate_tag_rules_js.py` and verify no diff if rules are already in sync.
- Run `python data/helperScripts/validate_tag_normalization.py` and confirm PASS.
- Run `python data/helperScripts/audit_tag_vocab.py --json-out data/enriched/tag_vocab_audit.json` and inspect `summary` + per-source diagnostics.
