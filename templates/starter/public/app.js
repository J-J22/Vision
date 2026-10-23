// Shared helpers for every page. Include with <script src="/app.js"></script> before page scripts.

// Calls the API with the saved login token. Returns parsed JSON or throws Error(message).
async function api(path, options = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function currentUser() {
  try { return JSON.parse(localStorage.getItem("user") ?? "null"); } catch { return null; }
}

function formatPrice(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Pages call renderNav() and get a consistent top bar. NAV_LINKS can be extended by pages.js.
const NAV_LINKS = window.NAV_LINKS ?? [];
// Light/dark: theme.css styles :root[data-theme="dark"]; the choice is remembered per browser
function setTheme(mode) {
  document.documentElement.dataset.theme = mode;
  try { localStorage.setItem("theme", mode); } catch {}
}
function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}
try {
  const saved = localStorage.getItem("theme");
  if (saved) document.documentElement.dataset.theme = saved;
  else if (window.THEME_TOGGLE && matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";
} catch {}

function renderNav() {
  const user = currentUser();
  const links = NAV_LINKS.map((l) => `<a href="${l.href}">${escapeHtml(l.label)}</a>`).join("");
  // Sites without accounts (portfolios, landing pages) set window.SHOW_LOGIN = false in site.js
  const account = window.SHOW_LOGIN === false ? "" : user ? `<span class="muted">${escapeHtml(user.name)}</span><a href="#" id="logout">Log out</a>` : `<a href="/login">Log in</a>`;
  const toggle = window.THEME_TOGGLE ? `<button type="button" class="theme-toggle secondary" id="theme-toggle" aria-label="Switch light or dark mode">◐</button>` : "";
  const nav = document.createElement("nav");
  nav.className = "nav";
  nav.innerHTML = `<a class="brand" href="/">${escapeHtml(window.APP_NAME ?? "My app")}</a>${links}${account}${toggle}`;
  document.body.prepend(nav);
  nav.querySelector("#theme-toggle")?.addEventListener("click", toggleTheme);
  nav.querySelector("#logout")?.addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    location.href = "/";
  });
}
