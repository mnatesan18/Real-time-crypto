"use client";

import { useEffect, useState, useRef } from "react";
import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { TickerService } from "../../../proto/gen/price_connect";
import { PriceUpdate, ListTickersResponse } from "../../../proto/gen/price_pb";
import styles from "./page.module.css";

const transport = createConnectTransport({
  baseUrl: "http://localhost:8080/api",
});

const client = createPromiseClient(TickerService, transport);

export default function Home() {
  const [ticker, setTicker] = useState("");
  const [tickers, setTickers] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceUpdate>>({});
  const [highlight, setHighlight] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");

  // Track controllers per ticker
  const streamControllers = useRef<Record<string, AbortController>>({});

  // ---- Fetch tickers from backend ----
  const fetchTickers = async () => {
    try {
      const res = (await client.listTickers({})) as ListTickersResponse;
      setTickers(res.tickers.sort((a, b) => a.localeCompare(b)));
    } catch (err) {
      console.error("ListTickers failed:", err);
      setMessage("Failed to fetch tickers");
    }
  };

  // ---- Add ticker ----
  const handleAddTicker = async () => {
    const normalized = ticker.trim().toUpperCase();
    if (!normalized) {
      setMessage("Please enter a valid ticker symbol");
      return;
    }
    try {
      await client.addTicker({ ticker: normalized });
      setTicker("");
      await fetchTickers();
    } catch (err) {
      console.error("AddTicker failed:", err);
      setMessage("Failed to add ticker");
    }
  };

  // ---- Remove ticker ----
  const handleRemoveTicker = async (symbol: string) => {
    try {
      await client.removeTicker({ ticker: symbol });
      await fetchTickers();
    } catch (err) {
      console.error("RemoveTicker failed:", err);
      setMessage("Failed to remove ticker (server issue)");
    } finally {
      // Abort only this ticker’s stream
      if (streamControllers.current[symbol]) {
        streamControllers.current[symbol].abort();
        delete streamControllers.current[symbol];
      }

      // Clean UI state
      setPrices((prev) => {
        const copy = { ...prev };
        delete copy[symbol];
        return copy;
      });
      setHighlight((prev) => {
        const copy = { ...prev };
        delete copy[symbol];
        return copy;
      });
      setTickers((prev) => prev.filter((t) => t !== symbol));
    }
  };

  // ---- Initial load ----
  useEffect(() => {
    fetchTickers();
  }, []);

  // ---- Start/stop one stream per ticker ----
  useEffect(() => {
    tickers.forEach((t) => {
      // Skip if already streaming
      if (streamControllers.current[t]) return;

      const controller = new AbortController();
      streamControllers.current[t] = controller;

      (async () => {
        try {
          const stream = client.streamPrices({ tickers: [t] }, { signal: controller.signal });

          for await (const update of stream as AsyncIterable<PriceUpdate>) {
            setPrices((prev) => ({ ...prev, [update.ticker]: update }));
            setHighlight((prev) => ({ ...prev, [update.ticker]: true }));
            setTimeout(() => {
              setHighlight((prev) => ({ ...prev, [update.ticker]: false }));
            }, 600);
          }
        } catch (err: any) {
          if (
            err?.name === "AbortError" ||
            err?.code === "canceled" ||
            /BodyStreamBuffer was aborted/.test(err?.message || "") ||
            /signal is aborted/.test(err?.message || "")
          ) {
            console.log(`🔄 Stream for ${t} aborted`);
          } else {
            console.error(`Stream error for ${t}:`, err);
            setMessage(`Error streaming ${t}`);
          }
        }
      })();
    });

    // Cleanup removed tickers’ streams
    Object.keys(streamControllers.current).forEach((t) => {
      if (!tickers.includes(t)) {
        streamControllers.current[t].abort();
        delete streamControllers.current[t];
      }
    });
  }, [tickers]);

  // ---- UI ----
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>💹 Crypto Price Tracker</h1>
      {message && <p style={{ color: "red" }}>{message}</p>}

      <div>
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Enter ticker (e.g., BTCUSDT)"
          className={styles.input}
        />
        <button onClick={handleAddTicker} className={styles.button}>
          Add Ticker
        </button>
      </div>

      <ul>
        {tickers.map((t) => (
          <li key={t}>
            {t}
            <button
              onClick={() => handleRemoveTicker(t)}
              className={styles.removeButton}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <h2>Live Prices</h2>
      <ul>
        {Object.keys(prices)
          .sort((a, b) => a.localeCompare(b))
          .map((t) => {
            const p = prices[t];
            return (
              <li key={t} className={highlight[t] ? styles.highlight : ""}>
                {p.ticker}: {p.price.toFixed(2)} (
                {new Date(Number(p.tsMs)).toLocaleTimeString()})
              </li>
            );
          })}
      </ul>
    </div>
  );
}
