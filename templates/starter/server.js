// Starter server. Agents don't edit this file: they add files to db/, routes/ and public/.
import express from "express";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { db, tx, runMigrations } from "./lib/db.js";
import { requireAuth, optionalAuth } from "./lib/auth.js";

const root = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.disable("x-powered-by");
// Basic security headers (framing stays allowed: Vision shows the app in a preview frame)
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" });
  next();
});

runMigrations(join(root, "db"));

// Every file in routes/ exports default function (app, ctx)
const ctx = { db, tx, requireAuth, optionalAuth };
for (const file of readdirSync(join(root, "routes")).filter((f) => f.endsWith(".js")).sort()) {
  const mod = await import(pathToFileURL(join(root, "routes", file)).href);
  mod.default(app, ctx);
}

app.use(express.static(join(root, "public"), { extensions: ["html"] }));

app.use("/api", (req, res) => res.status(404).json({ error: `No endpoint ${req.method} ${req.originalUrl}` }));
app.use((req, res) => res.status(404).sendFile(join(root, "public", "404.html")));

// Errors always come back as JSON, never as an HTML stack trace
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large" });
  if (err instanceof SyntaxError) return res.status(400).json({ error: "Body must be valid JSON" });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`app running on http://localhost:${port}`));
