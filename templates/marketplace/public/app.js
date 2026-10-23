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
function renderNav() {
  const user = currentUser();
  const links = NAV_LINKS.map((l) => `<a href="${l.href}">${escapeHtml(l.label)}</a>`).join("");
  const nav = document.createElement("nav");
  nav.className = "nav";
  nav.innerHTML = `<a class="brand" href="/">${escapeHtml(window.APP_NAME ?? "Marketplace")}</a>${links}${
    user ? `<span class="muted">${escapeHtml(user.name)}</span><a href="#" id="logout">Log out</a>` : `<a href="/login">Log in</a>`
  }`;
  document.body.prepend(nav);
  nav.querySelector("#logout")?.addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    location.href = "/";
  });
}
