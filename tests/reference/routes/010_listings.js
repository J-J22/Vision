function validate(body, partial) {
  const out = {};
  if (!partial || body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return { error: "Title is required" };
    if (body.title.trim().length > 200) return { error: "Title must be at most 200 characters" };
    out.title = body.title.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return { error: "Description must be text" };
    out.description = body.description.slice(0, 5000);
  }
  if (!partial || body.price_cents !== undefined) {
    if (!Number.isInteger(body.price_cents) || body.price_cents <= 0) return { error: "Price must be a positive whole number of cents" };
    out.price_cents = body.price_cents;
  }
  if (body.quantity !== undefined) {
    if (!Number.isInteger(body.quantity) || body.quantity < 0) return { error: "Quantity must be a whole number" };
    out.quantity = body.quantity;
  }
  return { value: out };
}

export default function (app, { db, requireAuth }) {
  const byId = (id) => db.prepare("SELECT * FROM listings WHERE id = ?").get(Number(id));

  app.get("/api/listings", (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const where = "status = 'active'" + (q ? " AND (title LIKE ? OR description LIKE ?)" : "");
    const params = q ? [`%${q}%`, `%${q}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE ${where}`).get(...params).n;
    const items = db.prepare(`SELECT * FROM listings WHERE ${where} ORDER BY id DESC LIMIT 20 OFFSET ?`).all(...params, (page - 1) * 20);
    res.json({ items, page, total });
  });

  app.get("/api/listings/:id", (req, res) => {
    const listing = byId(req.params.id);
    if (!listing) return res.status(404).json({ error: "Listing not found" });
    res.json({ listing });
  });

  app.post("/api/listings", requireAuth, (req, res) => {
    const { error, value } = validate(req.body ?? {}, false);
    if (error) return res.status(400).json({ error });
    const { lastInsertRowid } = db
      .prepare("INSERT INTO listings (seller_id, title, description, price_cents, quantity) VALUES (?, ?, ?, ?, ?)")
      .run(req.user.id, value.title, value.description ?? "", value.price_cents, value.quantity ?? 1);
    res.status(201).json({ listing: byId(Number(lastInsertRowid)) });
  });

  app.patch("/api/listings/:id", requireAuth, (req, res) => {
    const listing = byId(req.params.id);
    if (!listing) return res.status(404).json({ error: "Listing not found" });
    if (listing.seller_id !== req.user.id) return res.status(403).json({ error: "Only the seller can change this listing" });
    const { error, value } = validate(req.body ?? {}, true);
    if (error) return res.status(400).json({ error });
    const next = { ...listing, ...value };
    db.prepare("UPDATE listings SET title = ?, description = ?, price_cents = ?, quantity = ? WHERE id = ?")
      .run(next.title, next.description, next.price_cents, next.quantity, listing.id);
    res.json({ listing: byId(listing.id) });
  });

  app.delete("/api/listings/:id", requireAuth, (req, res) => {
    const listing = byId(req.params.id);
    if (!listing) return res.status(404).json({ error: "Listing not found" });
    if (listing.seller_id !== req.user.id) return res.status(403).json({ error: "Only the seller can delete this listing" });
    db.prepare("DELETE FROM listings WHERE id = ?").run(listing.id);
    res.json({ ok: true });
  });
}
