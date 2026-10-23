# Rules for agents writing code in this app

This is an Express + SQLite backend with a React frontend (Vite, Tailwind, React Router). It already has: a server, a
database, login (register, login, `me`), a sign-in page, a 404 page, the app shell (nav, footer, routing) and a component kit.
You add files. You never edit `server.js`, `lib/`, `db/001_core.sql`, `routes/000_*`, `routes/001_*`,
`web/src/components/ui.jsx`, `web/src/pages/Login.jsx`, `web/src/pages/NotFound.jsx` or anything else in `web/` not listed below.

## Where files go

| Folder | What | Naming |
|---|---|---|
| `db/` | SQL that creates tables, run in name order on every start | `010_projects.sql`, `020_messages.sql`, … Always `CREATE TABLE IF NOT EXISTS` |
| `routes/` | API endpoints, loaded in name order | `010_projects.js`, `020_messages.js`, … |
| `web/src/pages/` | React pages, one per file; each declares its own route | `Home.jsx`, `Projects.jsx`, `ProjectDetail.jsx`, `Dashboard.jsx`, … |
| `web/src/components/` | Shared React components for this app (optional) | `ProjectCard.jsx`, … |
| `web/src/theme.css`, `web/src/site.js` | The look, and the app's name and nav (theme task only) | |

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

## Pages (React)

Each page is one file in `web/src/pages/`. The shell finds it automatically (no router file to edit):

```jsx
import { useParams, useNavigate, Link } from "react-router-dom";
import { Package, Plus } from "lucide-react";                    // icons: any lucide-react icon
import { api, useApi, useUser, formatPrice, formatDate } from "../lib/api.js";
import { Button, Card, Badge, Field, Input, Textarea, Select, Section, PageHeader, Stat, EmptyState, Spinner, ErrorNote, Photo, cn } from "../components/ui.jsx";

export const route = "/projects/:id";   // required; the home page is "/"
export const auth = true;               // optional: signed-out visitors go to /login first

export default function ProjectDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useApi(`/api/projects/${id}`);
  if (loading) return <Spinner />;
  if (error) return <Section><ErrorNote>{error}</ErrorNote></Section>;
  const { project } = data;
  return <Section>…</Section>;
}
```

- Installed packages, and nothing else: `react`, `react-router-dom`, `lucide-react` (icons), `recharts` (charts), `clsx`.
- Data: `useApi(path)` for reads (`{ data, loading, error, reload }`), `await api(path, { method, body })` for writes (throws
  `Error(message)` on failure; show it with `<ErrorNote>`). `useUser()` is the signed-in user or null. Links use `<Link to>`.
- Component kit (`../components/ui.jsx`), styled by the theme: `Button` (variant primary|secondary|ghost|accent|danger,
  size sm|md|lg, `to` for links, `loading`), `Card` (`hover` lifts it), `Badge` (tone neutral|brand|accent|danger|ok),
  `Field` (label, hint, error) around `Input`/`Textarea`/`Select`, `Section` (full-width band with a centered container),
  `PageHeader` (eyebrow, title, description, actions), `Stat` (label, value, icon, change), `EmptyState` (icon, title,
  description, action), `Spinner`, `ErrorNote`, `Photo` (seed, w, h, alt: placeholder photos that always load), `cn`.
- Tailwind for everything else. Theme colors: `bg-brand text-brand-fg bg-accent bg-card bg-bg text-fg text-muted border-line
  text-danger text-ok`, with opacity like `bg-brand/10`; fonts `font-head`; radius `rounded-theme`. Dark mode just works.
- Charts (dashboards): `recharts` (`ResponsiveContainer`, `AreaChart`, `BarChart`, …) with `stroke="rgb(var(--brand))"`.
- Every page handles loading, errors and empty lists (`EmptyState`), and works from 360px phones up.
- Effects always use braces: `useEffect(() => { doThing(); }, [deps])`, never `useEffect(() => doThing(), …)`.
- The nav and footer come from `web/src/site.js`; don't build your own.

## Theme (`web/src/theme.css`, `web/src/site.js`)

Written once, by the theme task, from the Blueprint's design (feel, colors, references, devices).
- `theme.css`: optional `@import` of Google Fonts on the first line, then `:root { … }` setting EVERY variable:
  `--bg --card --fg --muted --line --brand --brand-fg --accent --danger --ok` as space-separated RGB triplets
  (e.g. `--brand: 37 99 235;`, never `#hex` or `rgb()`), plus `--radius` (e.g. `14px`), `--font` and `--font-head`.
  Use the colors the user asked for (brand = primary, accent = secondary). Add `[data-theme="dark"] { … }` with dark
  values for the colors when the design mentions dark mode. You may add a few global touches (selection color,
  smooth scrolling, a subtle background gradient on `body`), nothing that changes layout.
- `site.js`: `export default { name, tagline, nav: [{ to, label }], showLogin, themeToggle }`. `nav` lists the main pages;
  `showLogin: false` for sites without visitor accounts; `themeToggle: true` when there's a dark mode.
