# Heat Chase: Grand Escape

Stake Engine slot. 5x4 cluster/tumble with a Heat Meter and `The Getaway`
Hold & Spin bonus. The repo is split into the two deliverables Stake Engine
expects:

```txt
stake-math/        Math engine, optimizer, RTP verifier, and the EXACT
                   upload bundle at stake-math/publish_files/
stake-frontend/    Pixi game client + real Stake RGS integration +
                   a local mock-RGS server for offline testing
```

## stake-math

```bash
cd stake-math
npm install
npm run generate   # simulate -> optimize -> write publish_files -> verify
npm run verify     # recompute RTP/stats from the published lookup tables
npm test
```

Upload bundle (exact Stake names) — `stake-math/publish_files/`:

```txt
index.json
books_base.jsonl.zst             lookUpTable_base_0.csv
books_ante.jsonl.zst             lookUpTable_ante_0.csv
books_getaway.jsonl.zst          lookUpTable_getaway_0.csv
books_super_getaway.jsonl.zst    lookUpTable_super_getaway_0.csv
books_base_tier1..3.jsonl.zst    lookUpTable_base_tier1..3_0.csv
```

Mode names deliberately contain no restricted words (buy/bet/pay) — Stake's
social jurisdictions forbid them in math-file mode naming.

## stake-frontend

```bash
cd stake-frontend
npm install
npm run dev:local   # starts mock RGS + Vite, opens the game wired to RGS
npm run build       # static build -> stake-frontend/dist  (front-end upload)
npm test
```

In production the game reads `sessionID` / `rgs_url` from its iframe URL and
gets balance, currency, bet levels and bet modes from the live RGS. The mock
server speaks the same protocol against `stake-math/publish_files` so the
local run exercises the exact same code path.
