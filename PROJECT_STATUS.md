# PROJECT STATUS (Handoff)

## Last Updated
2026-05-06 (Asia/Shanghai)

## Goal
Recreate the duel camera + slap/dodge/counter feel of classic web slap-duel gameplay for mobile web, starting with 1 Hero + 1 NPC.

## Completed
1. Core combat prototype implemented (`src/main.ts`)
   - Turn timer
   - Attack window
   - Dodge cooldown
   - Counter window (only after successful dodge)
2. Mobile gesture controls
   - Attack: swipe `left` or `up`
   - Dodge: swipe `right` or `down`
3. Camera framing and roles
   - NPC on left (front-facing side profile)
   - Hero on right (over-shoulder/back view)
4. VFX feedback
   - Hit cue text
   - Impact burst
   - Speed lines
   - Screen shake
5. Face reaction system
   - NPC face popup on hit with damage levels
6. Asset pipeline work
   - Imported generated sprite sheets
   - Split/normalized to per-pose PNGs
   - Removed floating artifact fragments
7. Build is passing (`npm run build`)

## In Progress / Needs Polish
1. Hero prepare pose and attack weight
   - Improved compared to earlier version, but still can be tuned for stronger anticipation.
2. Some frame alignment
   - Minor per-pose anchor differences may still need pixel-level alignment.
3. Hit-face popup behavior
   - Works, but placement and duration can be further refined.

## Not Completed Yet
1. Full set of high-consistency production art
   - Need a controlled pipeline with locked camera template for all frames.
2. Additional gameplay systems
   - Multi-round progression, score breakdown, special conditions.
3. Audio design
   - Slap, dodge, counter, crowd/ambience, UI SFX.
4. Narrative layer
   - Dialogue, character intro, stage progression.
5. Deployment packaging
   - WeChat / Douyin mini-app adaptation not done yet.

## Recommended Next Steps
1. Lock final action frame set (hero + npc)
2. Add anticipation frame timing (pre-hit micro-stop)
3. Add explicit counter UI meter/ring
4. Add sound and camera punch tuning
5. Start mini-app compatibility pass

## Important Paths
- Game logic: `src/main.ts`
- UI style: `src/style.css`
- Hero assets: `public/assets/characters/player`
- NPC assets: `public/assets/characters/npc`
- NPC face assets: `public/assets/characters/npc_face`
