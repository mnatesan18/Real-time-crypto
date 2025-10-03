This is a fullstack app that tracks live crypto prices.

Backend (apps/server): Node.js + Playwright + ConnectRPC.

Frontend (apps/web): Next.js + React client.

Shared schema (proto/): Protocol Buffers (price.proto) define the TickerService API.

Script (run.sh): Boots the whole environment (install, generate code, run server and web).

🛠 Backend (apps/server) Main parts:

service.ts

Implements the TickerService defined in proto/price.proto.

Handles addTicker, removeTicker, listTickers, streamPrices.

Uses Playwright to open TradingView in a headless browser and scrape live prices.

Keeps one Playwright tab per ticker, managed in memory.

Each ticker runs in its own loop, streaming updates until removed.

index.ts

Bootstraps the ConnectRPC server and registers the routes.

playwright.ts

Utility to help manage Playwright pages.

Flow:

addTicker("BTCUSDT") → opens a TradingView tab, starts streaming.

removeTicker("BTCUSDT") → flags it to stop, closes tab after cleanup.

listTickers() → returns all active tickers.

streamPrices(["BTCUSDT", "ETHUSDT"]) → yields live price updates.

🎨 Frontend (apps/web) Main parts:

page.tsx

UI with:

Input field to add a ticker.

Button to remove tickers.

List of active tickers.

Live price updates.

Uses ConnectRPC client to call backend services.

Each ticker has its own independent stream (so deleting one doesn’t restart others).

Prices flash bold briefly on update (highlight effect).

page.module.css

Basic styling for container, buttons, highlight effect, etc.

Flow:

User enters “BTCUSDT” → calls backend addTicker.

UI calls listTickers to refresh state.

A new independent stream for BTCUSDT starts.

Prices appear in real time.

Removing BTCUSDT → aborts only that stream, UI updates instantly.

📡 Protos (proto/)

price.proto defines your API:

AddTickerRequest, RemoveTickerRequest

ListTickersResponse

StreamPricesRequest → PriceUpdate (with ticker, price, timestamp)

service TickerService with the four RPC methods.

buf.yaml, buf.gen.yaml

Used by Buf to generate TypeScript client/server stubs.

gen/price_pb.ts, gen/price_connect.ts

Generated code consumed by frontend and backend.

▶️ run.sh

This is your orchestration script:

Installs dependencies.

Runs buf generate to regenerate proto stubs.

Boots the backend (apps/server).

Boots the frontend (apps/web).

So one command ./run.sh sets up the whole project.

✅ Key Strengths

Realtime: true streaming updates (not polling).

Independent ticker streams: deleting one doesn’t kill others.

Playwright automation: you leverage TradingView UI directly.

Clean separation: proto defines API, backend implements, frontend consumes.

pnpm workspace: monorepo for server + web + shared proto.

⚠️ Things to Know

Node modules / build folders are excluded (regenerated on install/build).

Playwright must download Chromium the first time (automatic).

Tickers format: must match TradingView symbols (e.g., BTCUSDT).

Headless=false in Playwright means you’ll see the browser pop up; in CI, switch to true.

💡 How to Run

Clone repo → pnpm install.

Run ./run.sh.

Visit frontend (Next.js dev server, usually http://localhost:3000 ).

Add/remove tickers → watch prices stream.
