# ReliefLink hosted application

This is the production Next.js application. Neon Postgres is the shared source of
truth across authorized devices and food-bank accounts.

## Capabilities

- Food-bank administrator registration creates a site, account, map listing, and agent.
- Inventory Adjustment combines editable manual/plain-language entry and tolerant CSV import.
- All inventory appears in one editable spreadsheet with optimistic concurrency and an
  audit trail for manual and CSV intake.
- Registered food banks share category totals, committed quantities, safety stock, and
  verified availability on the network map while exact lots stay scoped.
- Each food-bank agent monitors expiration, low stock, and missing locations. It cannot
  place orders or make commitments without a human.
- Natural-language warehouse search uses OpenAI Structured Outputs to translate requests
  into allowlisted, parameterized, site-scoped database filters.
- The operational ATLAS team runs five persisted stages: Inventory, live NWS/OpenFEMA
  disruption plus least-squares demand forecasting, site negotiation, transport
  feasibility, and orchestration. Proposed commitments stop at a human approval boundary.

## Configuration

```bash
cd vision_agent/web
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Required for the persistent application:

- `DATABASE_URL`: pooled Neon Postgres connection string
- `AUTH_SECRET`: at least 32 characters
- `OPENAI_API_KEY`: optional text interpretation, warehouse search, and constrained negotiation explanations
- `OPENAI_TEXT_MODEL`: text tasks (defaults to `gpt-5-mini`)

ATLAS does not use an LLM to invent quantities or approve transfers. Optional model output
only explains a proposal; it falls back to deterministic copy if the API is unavailable. Quantities come from
the ledger, demand comes from approved dispatch history plus live disruption multipliers,
and route estimates use registered site coordinates. Model-generated search filters are
constrained by JSON Schema and compiled into parameterized SQL.

The database migrations are additive and safe to rerun.

## Vercel

Use `vision_agent/web` as the Root Directory. Configure the environment variables above,
run `npm run db:migrate` once against production Neon, and deploy the `main` branch.
`vision_agent/web` is retained only as the existing Vercel root-directory name; the
application no longer contains a vision agent or computer-vision functionality.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
