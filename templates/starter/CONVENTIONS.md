# Rules for agents writing code in this app

This is an Express + SQLite app. It already has: a server, a database, login (register, login, `me`), shared CSS and JS helpers.
You add files. You never edit `server.js`, `lib/`, `db/001_core.sql`, `routes/000_health.js`, `routes/001_auth.js`, `public/app.js`, `public/style.css` or `public/login.html`.

## Where files go

| Folder | What | Naming |
|---|---|---|
| `db/` | SQL that creates tables, run in name order on every start | `010_projects.sql`, `020_messages.sql`, … Always `CREATE TABLE IF NOT EXISTS` |
| `routes/` | API endpoints, loaded in name order | `010_projects.js`, `020_messages.js`, … |
| `public/` | Pages (plain HTML + inline `<script>`), served at `/name` for `name.html`; plus `theme.css` | `index.html`, `project.html`, `contact.html`, … |

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
`400` invalid input · `401` not logged in · `403` logged in but not allowed · `404` not found · `409` conflict (already exists, already done, sold out).
Validate every input: required strings must be non-empty after trimming; titles at most 200 characters; numbers must be integers ≥ 0 (prices > 0).

## The API contract (the automatic tests check exactly this)

Your task comes with the API CONTRACT the project manager designed for this app, and the EDGE-CASE TESTS the QA tester
wrote from it. Build exactly those endpoints: same methods, paths, field names and status codes. The tests run against them.

- Request bodies: a request with only the fields the contract lists must succeed. Any extra field you add (for this app's
  needs) is optional: give it a default in SQL (`DEFAULT ''`, `DEFAULT NULL`, …) and never return "missing field" for it.
- Responses: wrap results as the contract says (e.g. `{ project }` for one, `{ items }` for a list). Lists are newest first.
- Ownership: anything a user creates stores their `req.user.id`; only that user may change or delete it (403 for others).
- Missing ids return 404; malformed ids return 400 or 404, never 500.

## Pages

- Every page's `<head>` has `<meta name="description" content="…">` written for that page, `<link rel="icon" href="/favicon.svg">`,
  one `<h1>` per page, semantic tags (header, main, section, footer) and alt text on every image. Then, in this order: `<script src="https://cdn.tailwindcss.com/3.4.16"></script><script src="/tw.js"></script>`
  `<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/theme.css">`. At the end of `<body>`:
  `<script src="/site.js"></script><script src="/app.js"></script>`, then your script, which calls `renderNav(); renderFooter();`.
- Tailwind utility classes are available (no reset). Theme colors: `bg-brand text-brand bg-accent bg-card text-muted border-line`,
  fonts `font-head`, radius `rounded-theme`. Use Tailwind for layout and sections; keep the base classes for forms and buttons.
- Charts (dashboards): add `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>` to that
  page's `<head>` and draw with `new Chart(canvas, …)` using the theme's colors (read them with getComputedStyle).
  Dashboards: stat cards on top, a chart, then recent activity; all of it the signed-in user's own data.
- Photos: `https://picsum.photos/seed/<word>/<w>/<h>` (e.g. `https://picsum.photos/seed/laptop/800/500`) always loads; pick a
  seed word that fits. Icons: small inline SVGs (Lucide/Heroicons style, `stroke="currentColor"`), never emoji as icons.
- Use the helpers: `api(path, { method, body })` (sends the login token, throws `Error(message)` on failure), `currentUser()`,
  `formatPrice(cents)`, `escapeHtml(text)`. Always pass user content through `escapeHtml` before putting it in HTML.
- Base classes in style.css: `container`, `grid`, `card`, `muted`, `badge`, `row`, `stack`, `hero`, `error`, `success`,
  `button`, `secondary`, `empty`. Use them; put anything app-specific in `theme.css` (only the theme task writes it).
- Show errors in an element with class `error`, and an `empty` message when a list has nothing yet; never a blank page.
- `public/site.js` sets `window.APP_NAME`, `window.NAV_LINKS = [{ href, label }]`, `window.SHOW_LOGIN = false` when the
  app has no accounts for visitors (portfolio, landing page), and `window.THEME_TOGGLE = true` to show a light/dark switch.
- The nav is built for you: `<nav class="nav"><a class="brand">…</a><a>…</a>…</nav>` (no lists). Don't write your own nav.

## Theme (`public/theme.css`)

Written once, by the theme task, from the Blueprint's design (feel, colors, references, devices). It changes the LOOK,
never the layout:
- Set the variables in `:root`: `--bg`, `--card`, `--fg`, `--muted`, `--line`, `--brand`, `--brand-fg`, `--accent`, `--radius`,
  `--font`, `--font-head`, `--shadow`. Use the colors the user asked for (brand = primary, accent = secondary).
- If the design mentions dark mode or light and dark, also write `:root[data-theme="dark"] { … }` with the dark values,
  and set `window.THEME_TOGGLE = true` in site.js. Both modes need readable contrast.
- Restyle the shared classes (`.nav`, `.nav a`, `.nav .brand`, `.hero`, `.card`, `.button`, `button`, `.badge`, `h1`-`h3`,
  inputs) with colors, fonts, borders, radius, shadows and hover states. Never change `padding`, `margin`, `gap`, `display`,
  `grid-template-columns` or `max-width` of `.container`, `.grid`, `.row`, `.stack`: the pages rely on that spacing.
- Pick one or two fonts that fit the feel, from Google Fonts via `@import` on the first line. No other external files.
