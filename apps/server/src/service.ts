import { ConnectRouter } from "@connectrpc/connect";
import { chromium, Page } from "playwright";
import * as priceConnect from "../../../proto/gen/price_connect.js";

// ---- Safe import for TickerService ----
const TickerService =
  (priceConnect as any).TickerService ??
  (priceConnect as any).default?.TickerService;

if (!TickerService) {
  throw new Error("❌ TickerService not found in price_connect");
}

// ---- In-memory state ----
let tickers: Set<string> = new Set();              // ✅ use Set
let browser: any = null;
const pages: Record<string, Page> = {};
const stopFlags: Record<string, boolean> = {};
const lastPrices: Record<string, number> = {};

// ---- Helpers ----
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalizeTicker(x: string) {
  return x.toUpperCase().trim();
}

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: false });
    console.log("✅ Browser launched");
  }
  return browser;
}

// Open or validate a TradingView page
async function watchTradingView(ticker: string) {
  const b = await getBrowser();

  const page = await b.newPage();
  const url = `https://www.tradingview.com/symbols/${ticker}/?exchange=BINANCE`;
  console.log(`🌍 Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

  const priceLocator = page.locator("span.js-symbol-last");
  try {
    await priceLocator.first().waitFor({ timeout: 5000 });
  } catch {
    console.error(`❌ Invalid ticker: ${ticker}`);
    await page.close();
    return null;
  }
  return page;
}

// Ensure a watcher is running for `ticker`.
// If a previous watcher is stopping, wait for it to finish before starting a new one.
async function ensureWatcher(ticker: string, pushUpdate: (u: any) => void) {
  // If we're in the middle of stopping, wait until that watcher is gone.
  if (stopFlags[ticker]) {
    console.log(`⏳ Waiting for ${ticker} to finish stopping...`);
    while (pages[ticker]) {
      await sleep(100);
    }
  }

  // If a healthy watcher already exists, do nothing.
  if (pages[ticker] && !stopFlags[ticker]) {
    console.log(`🔄 Already watching ${ticker}`);
    return;
  }

  // Start a fresh watcher
  const page = await watchTradingView(ticker);
  if (!page) {
    console.log(`⚠️ Skipping ${ticker}, invalid symbol`);
    return;
  }

  pages[ticker] = page;
  stopFlags[ticker] = false;

  (async () => {
    const priceLocator = page.locator("span.js-symbol-last");

    while (!stopFlags[ticker]) {
      try {
        const txt = await priceLocator.first().textContent({ timeout: 15000 });
        if (txt) {
          const price = parseFloat(txt.replace(/,/g, ""));
          if (!isNaN(price) && price !== lastPrices[ticker]) {
            lastPrices[ticker] = price;
            const update = { ticker, price, tsMs: Date.now() };
            // console.log("💹 Price update:", update);
            pushUpdate(update);
          }
        }
      } catch (err) {
        console.error(`⚠️ fetch price failed for ${ticker}:`, err);
      }
      await page.waitForTimeout(2000);
    }

    // Cleanup OWNED BY LOOP ONLY
    console.log(`🛑 Stopped watching ${ticker}`);
    try {
      if (!page.isClosed()) await page.close();
    } catch {}
    delete pages[ticker];
    delete stopFlags[ticker];
    delete lastPrices[ticker];

    // If nothing left, close browser
    if (Object.keys(pages).length === 0 && browser) {
      try { await browser.close(); } catch {}
      browser = null;
      console.log("🧹 Closed browser (no tickers left)");
    }
  })();
}

// ---- Streaming generator ----
async function* priceStreamGenerator(requested: string[]) {
  // queue per-stream (not global) so each client gets its own updates
  let resolver: (u: any) => void;
  const pump = (u: any) => resolver?.(u);

  // Start / ensure watchers for each requested ticker
  for (const t of requested) {
    await ensureWatcher(t, pump);
  }

  // Stream forever, emitting newest update
  while (true) {
    const next = await new Promise<any>((resolve) => (resolver = resolve));
    yield next;
  }
}

// ---- Routes ----
export function routes(router: ConnectRouter) {
  router.service(TickerService, {
    async addTicker(req) {
      const t = normalizeTicker(req.ticker);

      // Set guarantees uniqueness
      tickers.add(t);
      console.log("➕ Added ticker:", t);
      return { tickers: Array.from(tickers).sort() };
    },

    async removeTicker(req) {
      const t = normalizeTicker(req.ticker);

      // Remove from Set, mark for stop. LOOP will clean up and close the page.
      tickers.delete(t);
      if (stopFlags[t] !== undefined) {
        stopFlags[t] = true;
      }
      console.log("➖ Marked ticker for removal:", t);

      return { tickers: Array.from(tickers).sort() };
    },

    async listTickers() {
      const sorted = Array.from(tickers).sort();
      console.log("📋 Listing tickers:", sorted);
      return { tickers: sorted };
    },

    async *streamPrices(req) {
      // Always stream *the list the client wants now*
      const now = req.tickers.map(normalizeTicker).sort();
      console.log("📡 Streaming prices for:", now);
      yield* priceStreamGenerator(now);
    },
  });
}
