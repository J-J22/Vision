// The app shell: nav, footer and routes. Agents don't edit this file.
// Every file in pages/ becomes a page: `export const route = "/projects/:id"` and a default component.
// `export const auth = true` sends signed-out visitors to /login first.
import { Component, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Menu, Moon, Sun, X } from "lucide-react";
import site from "./site.js";
import { logout, useUser } from "./lib/api.js";
import { cn } from "./components/ui.jsx";

const modules = import.meta.glob("./pages/*.jsx", { eager: true });
const pages = Object.entries(modules)
  .map(([file, m]) => ({ file, route: m.route, auth: m.auth, Page: m.default }))
  .filter((p) => typeof p.route === "string" && p.Page);

// A page that crashes shows an error card instead of a white screen
class PageBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg space-y-3 px-5 py-24 text-center">
        <h1 className="text-2xl font-bold">Something went wrong on this page</h1>
        <p className="text-sm text-muted">{String(this.state.error?.message ?? this.state.error)}</p>
        <a href="/" className="inline-block rounded-theme bg-brand px-5 py-2.5 font-semibold text-brand-fg">Back to home</a>
      </div>
    );
  }
}

function Guard({ page }) {
  const user = useUser();
  const location = useLocation();
  if (page.auth && !user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <page.Page />;
}

function ThemeToggle() {
  const [mode, setMode] = useState(() => document.documentElement.dataset.theme || "light");
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem("theme", mode); } catch {}
  }, [mode]);
  return (
    <button aria-label="Switch light or dark mode" onClick={() => setMode(mode === "dark" ? "light" : "dark")} className="rounded-theme p-2 text-muted hover:bg-line/50 hover:text-fg">
      {mode === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

function Nav() {
  const user = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  const links = site.nav ?? [];
  const linkCls = ({ isActive }) => cn("rounded-theme px-3 py-2 text-sm font-medium transition", isActive ? "text-fg" : "text-muted hover:text-fg");
  const account = site.showLogin === false ? null : user ? (
    <>
      <span className="hidden text-sm text-muted lg:inline">{user.name}</span>
      <button className="rounded-theme px-3 py-2 text-sm font-medium text-muted hover:text-fg" onClick={() => { logout(); navigate("/"); }}>Log out</button>
    </>
  ) : (
    <Link to="/login" className="rounded-theme bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:brightness-110">Log in</Link>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
        <Link to="/" className="mr-auto font-head text-lg font-bold">{site.name}</Link>
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => <NavLink key={l.to} to={l.to} end={l.to === "/"} className={linkCls}>{l.label}</NavLink>)}
        </nav>
        <div className="hidden items-center gap-2 md:flex">{site.themeToggle && <ThemeToggle />}{account}</div>
        <button className="rounded-theme p-2 md:hidden" aria-label="Menu" onClick={() => setOpen(!open)}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      </div>
      {open && (
        <div className="space-y-1 border-t border-line px-5 py-3 md:hidden">
          {links.map((l) => <NavLink key={l.to} to={l.to} end={l.to === "/"} className={(s) => cn(linkCls(s), "block")}>{l.label}</NavLink>)}
          <div className="flex items-center gap-2 pt-2">{site.themeToggle && <ThemeToggle />}{account}</div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-head font-bold">{site.name}</p>
          {site.tagline && <p className="text-sm text-muted">{site.tagline}</p>}
        </div>
        <nav className="flex flex-wrap gap-4 text-sm text-muted">
          {(site.nav ?? []).map((l) => <Link key={l.to} to={l.to} className="hover:text-fg">{l.label}</Link>)}
        </nav>
        <p className="text-sm text-muted">© {new Date().getFullYear()} {site.name}</p>
      </div>
    </footer>
  );
}

export default function App() {
  const location = useLocation();
  // Braces matter: newer browsers return a Promise from scrollTo, and React would call it as a cleanup
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => { document.title = site.name; }, []);
  const notFound = pages.find((p) => p.route === "*");
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="flex-1">
        <Routes>
          {pages.filter((p) => p.route !== "*").map((p) => <Route key={p.file} path={p.route} element={<PageBoundary key={p.file}><Guard page={p} /></PageBoundary>} />)}
          {notFound && <Route path="*" element={<notFound.Page />} />}
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
