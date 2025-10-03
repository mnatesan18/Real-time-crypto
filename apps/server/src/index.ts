import express, { Express } from "express";
import cors from "cors";
import { expressConnectMiddleware } from "@connectrpc/connect-express";
import { routes } from "./service";

const app: Express = express(); // ✅ FIXED — call express()

// Debug logging
app.use((req, res, next) => {
  console.log(`👉 Incoming: ${req.method} ${req.url}`);
  next();
});

// Enable CORS for frontend (only needed if skipping Next.js proxy)
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Connect-Protocol-Version",
      "Connect-Timeout-Ms",
    ],
    credentials: true,
  })
);

// Handle preflight
app.options("*", cors());

// Mount ConnectRPC routes
app.use("/api", expressConnectMiddleware({ routes }));

// Start server
app.listen(8080, () => {
  console.log("🚀 Server running at http://localhost:8080/api");
});
