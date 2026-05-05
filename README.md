# Rose-Camellia

A mobile-first web prototype inspired by aristocratic slap-duel gameplay.

## Tech Stack
- Vite + TypeScript
- PixiJS (2D rendering)
- Pure gesture input for mobile play

## Current Gameplay Loop
- Turn-based duel between Hero (right side) and NPC (left side)
- Attack turn: swipe `left` or `up` to attack
- Defense turn: swipe `right` or `down` to dodge
- Counter window appears only after a successful dodge

## Run Locally
```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5199 --strictPort
```

Open: `http://127.0.0.1:5199`

## Build
```bash
npm run build
```

## Project Structure
- `src/main.ts`: combat logic, state machine, gestures, timing windows, VFX triggers
- `src/style.css`: HUD and mobile layout styles
- `public/assets/characters/player`: hero pose textures
- `public/assets/characters/npc`: npc pose textures
- `public/assets/characters/npc_face`: npc face-damage popup textures

## Notes
- Current art is normalized from generated sheets and cleaned of floating fragments.
- Visual feel and mechanics are intentionally close to classic slap-duel rhythm, but with original assets.
