export default function (app) {
  app.get("/api/health", (req, res) => res.json({ ok: true }));
}
