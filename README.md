# Last Rocket to the Moon

HackWashU 2026 · theme "Fly Me to the Moon" · Photon Bonus Track

Earth has hours left. You can bring **one thing** with you. Snap a photo of whatever is next to you, and the ship AI rigs it into gear for the trip. It changes which moves you can make over 5 stages from Earth to the Moon, and the ending remembers whether it survived.

## Run it

Needs Node ≥ 23.6 (runs `.ts` directly) or Bun. No runtime dependencies.

```bash
npm start          # or: bun src/main.ts
```

On Windows you can also double-click **Start game.cmd** (game server, opens the host console) or **Rehearse big screen.cmd** (big screen with bot players on :3100).

- http://localhost:3000 is the landing page
- http://localhost:3000/phone is the iMessage simulator (stand-in for the Photon channel)
- **🖥 Bridge** in the simulator header opens the live bridge view for that run

To play over real iMessage, put your Photon Spectrum `PROJECT_ID` and `PROJECT_SECRET` in `.env` (from the [Photon dashboard](https://app.photon.codes), or `npx @photon-ai/cli projects secret --project <id> --json`). `npm start` then connects automatically; registered users text their assigned number (`npx @photon-ai/cli spectrum users list`). The first message ("join" or "加入") also picks English or Chinese.

Also optional in `.env`: `GEMINI_API_KEY` enables photo recognition, free-text parsing and ending narration. Without it, the game still plays end to end: typed item descriptions and photo captions are matched by keywords, and unclear replies fall back to numbered options.

```bash
npm test           # engine, input parsing, dedupe, service
npm run simulate   # balance table: win rate per starting item
npm run typecheck  # needs `npm install` (typescript + @types/node)
```

## How it works

```
channel (sim | Photon) → GameService (per-player serial queue, dedupe, AI fallback chain)
                       → engine.step(state, input) → save → send to phone → SSE to bridge
```

- `src/engine/`: pure state machine. All numbers, rarity and resolution live here; no I/O.
- `src/ai/`: Gemini with hard timeouts. It can only choose from fixed lists, and every output is validated.
- `content/*.json`: every event, item, upgrade, combo, ending and line of copy.
- Input understanding: number → keywords → AI → clarify once → numbered options.
