// Edge-case tests for a generated marketplace. They check the core API in templates/marketplace/CONVENTIONS.md.
// Usage: node tests/edge-cases/run.mjs http://localhost:4100
// Prints one JSON array: [{ name, area, passed, detail }]

const base = process.argv[2] ?? "http://localhost:4000";
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

let userCount = 0;
async function newUser() {
  const email = `t${runId}-${++userCount}@test.dev`;
  const r = await call("POST", "/api/auth/register", { body: { email, password: "secret123", name: `Tester ${userCount}` } });
  if (r.status !== 201) throw new Error(`Setup failed: register returned ${r.status}`);
  return r.data.token;
}

async function newListing(token, overrides = {}) {
  const r = await call("POST", "/api/listings", {
    token,
    body: { title: `Calculus textbook ${runId}`, description: "Good condition", price_cents: 2500, quantity: 1, ...overrides },
  });
  if (r.status !== 201 || !r.data?.listing?.id) throw new Error(`Creating a listing returned ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data.listing;
}

function expectStatus(r, allowed, what) {
  const ok = Array.isArray(allowed) ? allowed.includes(r.status) : r.status === allowed;
  if (!ok) throw new Error(`${what}: expected ${allowed}, got ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`);
}

const tests = [
  {
    name: "Creating a listing requires login",
    area: "auth",
    run: async () => expectStatus(await call("POST", "/api/listings", { body: { title: "x", price_cents: 100 } }), 401, "POST /api/listings without login"),
  },
  {
    name: "Negative price is rejected",
    area: "data",
    run: async () => {
      const t = await newUser();
      expectStatus(await call("POST", "/api/listings", { token: t, body: { title: "Book", description: "", price_cents: -500 } }), 400, "price_cents -500");
    },
  },
  {
    name: "Empty title is rejected",
    area: "data",
    run: async () => {
      const t = await newUser();
      expectStatus(await call("POST", "/api/listings", { token: t, body: { title: "   ", description: "", price_cents: 500 } }), 400, "blank title");
    },
  },
  {
    name: "Very long title is rejected",
    area: "data",
    run: async () => {
      const t = await newUser();
      expectStatus(await call("POST", "/api/listings", { token: t, body: { title: "A".repeat(5000), description: "", price_cents: 500 } }), [400, 413], "5000-character title");
    },
  },
  {
    name: "Nobody can edit someone else's listing",
    area: "auth",
    run: async () => {
      const seller = await newUser();
      const other = await newUser();
      const listing = await newListing(seller);
      expectStatus(await call("PATCH", `/api/listings/${listing.id}`, { token: other, body: { price_cents: 1 } }), 403, "PATCH by another user");
    },
  },
  {
    name: "Sellers can't buy their own listing",
    area: "features",
    run: async () => {
      const seller = await newUser();
      const listing = await newListing(seller);
      expectStatus(await call("POST", "/api/orders", { token: seller, body: { listing_id: listing.id } }), 400, "seller buying own listing");
    },
  },
  {
    name: "The last item can't be sold twice",
    area: "payments",
    run: async () => {
      const seller = await newUser();
      const buyerA = await newUser();
      const buyerB = await newUser();
      const listing = await newListing(seller, { quantity: 1 });
      expectStatus(await call("POST", "/api/orders", { token: buyerA, body: { listing_id: listing.id } }), 201, "first purchase");
      expectStatus(await call("POST", "/api/orders", { token: buyerB, body: { listing_id: listing.id } }), 409, "second purchase of a sold-out item");
    },
  },
  {
    name: "A repeated payment confirmation is ignored",
    area: "payments",
    run: async () => {
      const seller = await newUser();
      const buyer = await newUser();
      const listing = await newListing(seller);
      const order = await call("POST", "/api/orders", { token: buyer, body: { listing_id: listing.id } });
      expectStatus(order, 201, "placing the order");
      const body = { order_id: order.data.order.id, payment_id: `pay_${runId}` };
      expectStatus(await call("POST", "/api/payments/confirm", { token: buyer, body }), 200, "first confirmation");
      const again = await call("POST", "/api/payments/confirm", { token: buyer, body });
      expectStatus(again, 200, "same confirmation sent again");
      if (again.data?.order?.status !== "paid") throw new Error(`After a repeated confirmation the order status is ${again.data?.order?.status}, expected paid`);
    },
  },
  {
    name: "An order can't be refunded twice",
    area: "payments",
    run: async () => {
      const seller = await newUser();
      const buyer = await newUser();
      const listing = await newListing(seller);
      const order = await call("POST", "/api/orders", { token: buyer, body: { listing_id: listing.id } });
      expectStatus(order, 201, "placing the order");
      const id = order.data.order.id;
      expectStatus(await call("POST", "/api/payments/confirm", { token: buyer, body: { order_id: id, payment_id: `pay2_${runId}` } }), 200, "paying");
      expectStatus(await call("POST", `/api/orders/${id}/refund`, { token: buyer }), 200, "first refund");
      expectStatus(await call("POST", `/api/orders/${id}/refund`, { token: buyer }), 409, "second refund");
    },
  },
  {
    name: "Search works with emoji",
    area: "features",
    run: async () => {
      const seller = await newUser();
      const listing = await newListing(seller, { title: `📚 Physics notes ${runId}` });
      const r = await call("GET", `/api/listings?q=${encodeURIComponent("📚")}`);
      expectStatus(r, 200, "search for 📚");
      if (!r.data?.items?.some((i) => i.id === listing.id)) throw new Error("The emoji listing was not in the search results");
    },
  },
  {
    name: "A page past the end returns an empty list",
    area: "api",
    run: async () => {
      const r = await call("GET", "/api/listings?page=9999");
      expectStatus(r, 200, "page 9999");
      if (!Array.isArray(r.data?.items) || r.data.items.length !== 0) throw new Error(`Expected items: [], got ${JSON.stringify(r.data).slice(0, 200)}`);
    },
  },
  {
    name: "A missing listing returns 404",
    area: "api",
    run: async () => expectStatus(await call("GET", "/api/listings/99999999"), 404, "unknown listing id"),
  },
];

const results = [];
for (const t of tests) {
  try {
    await t.run();
    results.push({ name: t.name, area: t.area, passed: true });
  } catch (err) {
    results.push({ name: t.name, area: t.area, passed: false, detail: String(err.message ?? err) });
  }
}
console.log(JSON.stringify(results));
