# Rules for agents writing code in this app

This is an Express + SQLite app. It already has: a server, a database, login (register, login, `me`), shared CSS and JS helpers.
You add files. You never edit `server.js`, `lib/`, `db/001_core.sql`, `routes/000_health.js`, `routes/001_auth.js`, `public/app.js`, `public/style.css` or `public/login.html`.

## Where files go

| Folder | What | Naming |
|---|---|---|
| `db/` | SQL that creates tables, run in name order on every start | `010_listings.sql`, `020_orders.sql`, … Always `CREATE TABLE IF NOT EXISTS` |
| `routes/` | API endpoints, loaded in name order | `010_listings.js`, `020_orders.js`, … |
| `public/` | Pages (plain HTML + inline `<script>`), served at `/name` for `name.html` | `index.html`, `listing.html`, `sell.html`, … |

## Database (node:sqlite, synchronous)

```js
db.prepare("SELECT * FROM listings WHERE id = ?").get(id);            // one row or undefined
db.prepare("SELECT * FROM listings WHERE seller_id = ?").all(userId);  // array
const { lastInsertRowid, changes } = db.prepare("INSERT INTO ...").run(a, b);  // lastInsertRowid may be a BigInt: wrap in Number()
tx(() => { /* several statements that must all succeed or all fail */ });
```
There is no `db.transaction()`: use `tx(fn)`. Store money as integer cents. Timestamps: `TEXT DEFAULT (datetime('now'))`.

## Route file shape

```js
export default function (app, { db, tx, requireAuth, optionalAuth }) {
  app.get("/api/things", (req, res) => { ... });
  app.post("/api/things", requireAuth, (req, res) => { ... });   // req.user = { id, email, name, role }
}
```
Use ES module syntax only (`import`/`export`), no `require`. Handlers are synchronous; no `await` is needed for the database.
**Don't import any packages.** Only `express` and Node built-ins (`node:crypto`, …) are installed; anything else crashes the app.
Everything you need (`db`, `tx`, `requireAuth`, `optionalAuth`) arrives in the second argument. Use `?` placeholders for SQL values; never build SQL from strings.

## Errors

Always respond with JSON `{ "error": "message a user can read" }` and the right status:
`400` invalid input · `401` not logged in · `403` logged in but not allowed · `404` not found · `409` conflict (sold out, already done).
Validate every input: required strings must be non-empty after trimming; titles at most 200 characters; numbers must be integers ≥ 0 (prices > 0).

## Required core API (the automatic tests check exactly this)

Every marketplace must have these, with these exact paths and field names. Add more endpoints for the Blueprint's other features.

**Extra fields are always optional.** You may add columns and body fields for this app (ISBN, author, condition, size, delivery…), but a request with only the fields listed below must still succeed: give every extra column a default (`DEFAULT ''`, `DEFAULT NULL`, or a sensible value) and never return "missing field" for one. The automatic tests send only the fields below.

**Listings** table `listings`: `id, seller_id, title, description, price_cents, quantity, status ('active' | 'sold'), created_at`

| Endpoint | Rules |
|---|---|
| `GET /api/listings?q=&page=` | Public. Active listings, newest first, 20 per page, `page` starts at 1. `q` searches title and description (any characters, including emoji). Returns `{ items, page, total }`. A page past the end returns `items: []`, not an error. |
| `GET /api/listings/:id` | Public. `{ listing }` or 404. |
| `POST /api/listings` | Login required. Body `{ title, description, price_cents, quantity }` (quantity defaults to 1). Returns 201 `{ listing }`. |
| `PATCH /api/listings/:id` | Seller only (403 for anyone else). Same fields, all optional, same validation. Returns `{ listing }`. |
| `DELETE /api/listings/:id` | Seller only. Returns `{ ok: true }`. |

**Orders** table `orders`: `id, listing_id, buyer_id, quantity, total_cents, status ('pending' | 'paid' | 'refunded'), payment_id, created_at`

| Endpoint | Rules |
|---|---|
| `POST /api/orders` | Login required. Body `{ listing_id, quantity }` (default 1). 404 if the listing doesn't exist, 400 if buying your own listing, 409 if not enough quantity left. Reduce the listing's quantity and set `status = 'sold'` at 0, inside `tx()`. Returns 201 `{ order }` with status `pending`. |
| `GET /api/orders` | Login required. The user's own orders as `{ items }`. |
| `POST /api/payments/confirm` | Login required, buyer only. Body `{ order_id, payment_id }`. Marks the order `paid`. Payments are mocked. Sending the same `payment_id` again returns 200 with the same order and changes nothing. |
| `POST /api/orders/:id/refund` | Buyer only. Only a `paid` order can be refunded: returns `{ order }` with status `refunded` and puts the quantity back. A second refund returns 409. |

## Pages

- Every page includes, in this order: `<link rel="stylesheet" href="/style.css">`, then before your script `<script src="/site.js"></script><script src="/app.js"></script>`, and calls `renderNav()`.
- Use the helpers: `api(path, { method, body })` (sends the login token, throws `Error(message)` on failure), `currentUser()`, `formatPrice(cents)`, `escapeHtml(text)`.
- Always pass user content through `escapeHtml` before putting it in HTML.
- Use the existing CSS classes: `container`, `grid`, `card`, `price`, `muted`, `badge`, `row`, `error`, `success`, `button`, `secondary`.
- Show errors to the user in an element with class `error`; never leave a blank page.
- `public/site.js` sets `window.APP_NAME` and `window.NAV_LINKS = [{ href, label }]`.
