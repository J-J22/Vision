export default function (app, { db, tx, requireAuth }) {
  const orderById = (id) => db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(id));

  app.post("/api/orders", requireAuth, (req, res) => {
    const listingId = Number(req.body?.listing_id);
    const quantity = req.body?.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ error: "Quantity must be at least 1" });
    const result = tx(() => {
      const listing = db.prepare("SELECT * FROM listings WHERE id = ?").get(listingId);
      if (!listing) return { status: 404, error: "Listing not found" };
      if (listing.seller_id === req.user.id) return { status: 400, error: "You can't buy your own listing" };
      if (listing.status !== "active" || listing.quantity < quantity) return { status: 409, error: "Not enough left in stock" };
      const left = listing.quantity - quantity;
      db.prepare("UPDATE listings SET quantity = ?, status = ? WHERE id = ?").run(left, left === 0 ? "sold" : "active", listing.id);
      const { lastInsertRowid } = db
        .prepare("INSERT INTO orders (listing_id, buyer_id, quantity, total_cents) VALUES (?, ?, ?, ?)")
        .run(listing.id, req.user.id, quantity, listing.price_cents * quantity);
      return { order: orderById(Number(lastInsertRowid)) };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ order: result.order });
  });

  app.get("/api/orders", requireAuth, (req, res) => {
    res.json({ items: db.prepare("SELECT * FROM orders WHERE buyer_id = ? ORDER BY id DESC").all(req.user.id) });
  });

  app.post("/api/payments/confirm", requireAuth, (req, res) => {
    const { order_id, payment_id } = req.body ?? {};
    if (typeof payment_id !== "string" || !payment_id) return res.status(400).json({ error: "payment_id is required" });
    const order = orderById(order_id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.buyer_id !== req.user.id) return res.status(403).json({ error: "Only the buyer can pay for this order" });
    if (order.payment_id === payment_id) return res.json({ order });
    if (order.status !== "pending") return res.status(409).json({ error: "This order is already paid" });
    db.prepare("UPDATE orders SET status = 'paid', payment_id = ? WHERE id = ?").run(payment_id, order.id);
    res.json({ order: orderById(order.id) });
  });

  app.post("/api/orders/:id/refund", requireAuth, (req, res) => {
    const result = tx(() => {
      const order = orderById(req.params.id);
      if (!order) return { status: 404, error: "Order not found" };
      if (order.buyer_id !== req.user.id) return { status: 403, error: "Only the buyer can ask for a refund" };
      if (order.status !== "paid") return { status: 409, error: "Only a paid order can be refunded" };
      db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(order.id);
      db.prepare("UPDATE listings SET quantity = quantity + ?, status = 'active' WHERE id = ?").run(order.quantity, order.listing_id);
      return { order: orderById(order.id) };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ order: result.order });
  });
}
