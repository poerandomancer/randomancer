# agent.md

## Project: The Randomancer (Path of Exile 2 Build Randomizer)

You are an AI coding assistant working on **The Randomancer**, a single-page web app that generates themed, semi-cohesive Path of Exile 2 builds. It is a front-end–only project (HTML/CSS/JS + JSON data files), currently around version **0.8.2** (e.g. `index_0.8.2_cleanup.html`, `script_0.8.2_cleanup.js`, etc.).

The goal of this repository is to provide:
- A **fun, inspirational build randomizer** (not a perfect simulator),
- With **smart but lightweight rules** to avoid obviously broken combinations,
- And **highly readable, maintainable code** that can support future features (like saving & sharing builds).

---

## Your Role

You are here to help implement and refine features in this codebase, with a special focus on:

1. **Understanding existing behavior**
   - How builds are rolled from core data (`data_*.json`),
   - How skill gems (`skill_gems.json`) and uniques (`uniques_enriched_*.json`) are selected and displayed,
   - How the “Cohesion / Chaos / Madness” slider influences choices.

2. **Implementing new functionality**
   - Especially the **“save / share build”** feature based on **snapshot-style build codes**.
   - You may also help with incremental refactors, small UX improvements, and quality-of-life changes.

3. **Preserving current user experience**
   - Do **not** break the current randomizer flow or UI.
   - Avoid unnecessary rewrites; focus on targeted, diff-friendly changes.

Think of yourself as a careful senior engineer joining an existing project: respect the current architecture, coding style, naming, and versioning.

---

## Codebase Overview

**Primary tech stack:**

- **HTML**  
  - `index.html` (or similar versioned index)  
  - Defines the single-page layout, app container, intro overlay, info dialog, and section placeholders.

- **CSS**  
  - `styles.css`  
  - Randomancer’s dark-fantasy visual theme, layout, typography, attribute bar visuals, card layouts, etc.

- **JavaScript**  
  - `core-script.js` (and prior versions: `script_0.8.1_release.js`, etc.)  
  - Orchestrates:
    - Data loading from JSON files,
    - Build roll pipeline (class → ascendancy → weapons → ailments/tactics → defense → skills → uniques),
    - Cohesion mode logic,
    - UI rendering and DOM updates,
    - Any existing helper utilities and rules.

- **Data files (JSON)**  
  - `core-data.json`  
    - Core build components: Classes, Ascendancies, Weapons, Off-hands, Ailments, Tactics, Defensive layers, etc.
    - Includes attribute weightings (`strength`, `dexterity`, `intelligence`) per entity.
  - `skill_gems.json`  
    - Full datamined skill gem data (active + support gems), tags, descriptions, requirements.
    - Used to pick **Recommended Skills** and **Recommended Supports** based on the rolled build.
  - `skills.json`  
    - Additional skill metadata or alternate structured view (depending on version).
  - `uniques_enriched.json`  
    - Curated list of unique items.
    - Includes: slot (amulet, ring, weapon, etc.), name, base, enriched tag structure, and a `lines` array for the tooltip-style description text.
  - `Uniques.zip`  
    - Source data used to produce `uniques_enriched_*` versions.

File names used to be versioned (e.g. `*_0.8.1_release`, `*_0.8.2_cleanup`) but are no longer. There is an internal APP_Version defined._

---

## Key Concepts

### 1. Randomization Pipeline

A typical build roll does roughly:

1. Pick a **Class** and **Ascendancy** from `data_*.json`.
2. Choose **Weapons** (main-hand and off-hand) consistent with rules (e.g., off-hand compatibility).
3. Choose **Ailments** and **Tactics** with attribute and tag-based coherence.
4. Choose **Defense** and **Defensive Strategy** that roughly align with the build’s attributes.
5. Compute and render an **Attribute Balance** summary (Strength/Dexterity/Intelligence).
6. Select **two recommended active skills** (and supports) from `skill_gems.json` that fit:
   - Weapon tags (e.g., bow-only skills with bows, etc.),
   - Ailments and tactics where possible.
7. Pick a handful of **Unique items** that synergize with the build’s tags and theme.

The **Cohesion slider** biases the RNG:
- **Strict / Cohesive** → more attribute and tag alignment.
- **Chaotic / Madness** → more creative / off-meta combinations.

### 2. Data-Driven Logic

Most logic should be **data-driven**, not hard-coded per specific skill or item.

Examples:
- Attribute weights guide build balance and synergy scores.
- Tag arrays (e.g., `"freeze"`, `"ignite"`, `"crit"`, `"block"`, `"minions"`) are used to:
  - Match skills to ailments/tactics,
  - Match uniques to the rest of the build.

Where possible, prefer **generic helpers** that operate on attributes/tags over one-off special cases.

---

## Current Feature Focus: Save / Share Build

The next major feature is a **save/share build system**, likely implemented as:

- A **build snapshot**: a compact representation of the fully-rolled build (class, ascendancy, weapons, defenses, ailments, tactics, skills, supports, uniques, and maybe RNG seeds).
- Encoded as a **short “build code” string** (e.g., base64, URL-safe encoding, or a compact JSON → encoded string).
- Shareable via:
  - A **URL query parameter** (e.g., `?build=...`), and/or
  - A **text code** the player can copy and paste.

**High-level expectations:**

- There should be a clear boundary between:
  1. **Ephemeral state** (current roll in memory), and  
  2. **Serializable state** (minimal data needed to reconstruct or display the same build).

- Loading the page with a build code should:
  - **Bypass randomization**, and
  - **Render the exact same build** (or very close, if data changed, with graceful fallback).

- The feature must **not require a backend**:
  - No databases, no user accounts.
  - Everything is client-side encoding/decoding + URL handling.

---

## Constraints and Non-Goals

- **No backend services**: Keep everything in the browser.
- **No heavy framework migration**: Do not convert to React/Vue/etc.
- **Do not introduce build tooling** (webpack, Vite, etc.) unless explicitly requested.
- **Avoid massive rewrites** that remove the current structure or comments.

- You may:
  - Introduce **small helper modules or objects** within the current `script_*.js` file,
  - Refactor functions for clarity, as long as behavior is preserved,
  - Add concise comments to clarify complex logic.

---

## How You Should Work

When responding:

1. **Read existing code first.**  
   Understand how data flows from JSON into the UI. Look for existing state objects and DOM render functions.

2. **Propose a plan.**  
   Before dropping a huge diff, outline:
   - What data you’ll capture for a build snapshot,
   - How you’ll encode/decode it,
   - Where in the code you’ll plug into the roll pipeline and UI.

3. **Provide targeted patches.**  
   - Show **only the relevant sections** of `script_*.js`, `index_*.html`, or CSS that change.
   - Use clear anchors like `// === Save/Share: Begin ===` where appropriate.
   - Avoid reformatting entire files; keep diff surface small and readable.

4. **Preserve behavior.**  
   - Confirm the default “Roll Your Fate” flow still works with no URL params.
   - Make sure intro auto-roll behavior (if present) still functions.
   - Ensure the UI degrades gracefully if a build code is invalid or incomplete.

5. **Explain edge cases.**  
   - What happens if the code references a skill or unique that no longer exists in the data?
   - How do you handle version mismatches between build codes and data files?

Your end result should feel like a natural extension of the current Randomancer app, not a new app stapled on top.

---
