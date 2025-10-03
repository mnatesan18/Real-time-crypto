import { chromium, Page } from "playwright";
import { ConnectRouter } from "@connectrpc/connect";
import * as priceConnect from "../../../proto/gen/price_connect.js";

const TickerService =
  (priceConnect as any).TickerService ??
  (priceConnect as any).default?.TickerService;

if (!TickerService) {
  throw new Error("❌ TickerService not found in price_connect");
}

let browser: any;
const tickerPages: Record<string, Page> = {}; // ticker -> Playwright Page
let tickers: string[] = [];

// --- Launch browser once ---
async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: false }); // visible browser
  }
  return browser;
}

// --- Open a new tab for ticker ---
async function watchTradingView(ticker: string) {
  const b = await getBrowser();
  if (tickerPages[ticker]) return tickerPages[ticker]; // reuse

  const page = await b.newPage();
  const url = `https://www.tradingview.com/symbols/${ticker}/?exchange=BINANCE`;
  console.log(`🌍 Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  tickerPages[ticker] = page;
  return page;
}

// --- Async generator that streams prices ---
async function* priceStreamGenerator(requested: string[]) {
  const queue: any[] = [];
  let push: ((val: any) => void) | undefined;  // ✅ fixed type

  for (const ticker of requested) {
    const page = await watchTradingView(ticker);

    // Poll every 2s
    (async () => {
      const locator = page.locator(
        `div[data-symbol="BINANCE:${ticker}"] span.js-symbol-last`
      );

      while (true) {
        try {
          const text = await locator.first().textContent({ timeout: 10000 });
          if (text) {
            const price = parseFloat(text.replace(/,/g, ""));
            const update = {
              ticker,
              price,
              tsMs: Date.now(),
            };

            if (push) {
              push(update);   // ✅ now callable
              push = undefined;
            } else {
              queue.push(update);
            }
          }
        } catch (err) {
          console.error(`⚠️ ${ticker} fetch failed:`, err);
        }
        await page.waitForTimeout(2000);
      }
    })();
  }

  while (true) {
    if (queue.length > 0) {
      yield queue.shift();
    } else {
      yield await new Promise<any>((resolve) => (push = resolve));
    }
  }
}

// --- ConnectRPC routes ---
export function routes(router: ConnectRouter) {
  router.service(TickerService, {
    async addTicker(req) {
      const t = req.ticker.toUpperCase().trim();
      if (!tickers.includes(t)) tickers.push(t);
      console.log("➕ Added ticker:", t);
      return { tickers };
    },
    async removeTicker(req) {
      const t = req.ticker.toUpperCase().trim();
      tickers = tickers.filter((x) => x !== t);
      console.log("➖ Removed ticker:", t);
      return { tickers };
    },
    async listTickers() {
      return { tickers };
    },
    async *streamPrices(req) {
      console.log("📡 Streaming prices for:", req.tickers);
      yield* priceStreamGenerator(req.tickers);
    },
  });
}
