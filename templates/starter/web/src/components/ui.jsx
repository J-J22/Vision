// The component kit every page builds with. Agents don't edit this file; they import from "../components/ui.jsx".
// All colors come from the theme (bg-brand, text-muted, …), so the theme task restyles everything at once.
import clsx from "clsx";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";

export const cn = (...args) => clsx(...args);

const BUTTON = {
  primary: "bg-brand text-brand-fg hover:brightness-110 shadow-sm",
  secondary: "bg-card text-fg border border-line hover:bg-line/40",
  ghost: "text-fg hover:bg-line/50",
  accent: "bg-accent text-white hover:brightness-110 shadow-sm",
  danger: "bg-danger text-white hover:brightness-110",
};
const SIZE = { sm: "h-9 px-3 text-sm", md: "h-11 px-5", lg: "h-12 px-6 text-base" };

// <Button>Save</Button>, <Button variant="secondary" to="/about">About</Button>, <Button loading>…</Button>
export function Button({ variant = "primary", size = "md", to, href, loading, className, children, ...props }) {
  const cls = cn(
    "inline-flex items-center justify-center gap-2 rounded-theme font-semibold transition disabled:opacity-60 disabled:pointer-events-none",
    BUTTON[variant],
    SIZE[size],
    className,
  );
  const body = (
    <>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </>
  );
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  if (href) return <a href={href} className={cls} target="_blank" rel="noreferrer">{body}</a>;
  return <button className={cls} disabled={loading || props.disabled} {...props}>{body}</button>;
}

export function Card({ className, children, hover, ...props }) {
  return (
    <div className={cn("rounded-theme border border-line bg-card p-6 shadow-sm", hover && "transition hover:-translate-y-0.5 hover:shadow-lg", className)} {...props}>
      {children}
    </div>
  );
}

export function Badge({ tone = "neutral", className, children }) {
  const tones = { neutral: "bg-line/60 text-fg", brand: "bg-brand/10 text-brand", accent: "bg-accent/15 text-accent", danger: "bg-danger/10 text-danger", ok: "bg-ok/10 text-ok" };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

const FIELD = "w-full rounded-theme border border-line bg-card px-3.5 py-2.5 text-fg placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

// <Field label="Title" error={errors.title}><Input value=… onChange=… /></Field>
export function Field({ label, hint, error, children }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm font-semibold">{label}</span>}
      {children}
      {error ? <span className="block text-sm text-danger">{error}</span> : hint ? <span className="block text-sm text-muted">{hint}</span> : null}
    </label>
  );
}
export const Input = ({ className, ...props }) => <input className={cn(FIELD, className)} {...props} />;
export const Textarea = ({ className, ...props }) => <textarea className={cn(FIELD, "min-h-28", className)} {...props} />;
export const Select = ({ className, children, ...props }) => <select className={cn(FIELD, className)} {...props}>{children}</select>;

// Full-width page section with a centered container: <Section className="bg-card">…</Section>
export function Section({ className, inner, children }) {
  return (
    <section className={cn("py-16 sm:py-24", className)}>
      <div className={cn("mx-auto max-w-6xl px-5", inner)}>{children}</div>
    </section>
  );
}

// Top of an inner page: eyebrow, title, description and actions on the right
export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 pb-8 pt-12 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-brand">{eyebrow}</p>}
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {description && <p className="max-w-2xl text-lg text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </div>
  );
}

// Dashboard number: <Stat label="Listings" value={12} icon={Package} change="+3 this week" />
export function Stat({ label, value, icon: Icon, change }) {
  return (
    <Card className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-muted">{label}</p>
        <p className="mt-1 text-3xl font-bold">{value}</p>
        {change && <p className="mt-1 text-sm text-ok">{change}</p>}
      </div>
      {Icon && <span className="rounded-theme bg-brand/10 p-2.5 text-brand"><Icon className="h-5 w-5" /></span>}
    </Card>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-theme border border-dashed border-line px-6 py-14 text-center">
      {Icon && <Icon className="h-10 w-10 text-muted" />}
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="max-w-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted">
      <Loader2 className="h-5 w-5 animate-spin" /> {label}
    </div>
  );
}

export function ErrorNote({ children }) {
  return children ? <p className="rounded-theme border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{children}</p> : null;
}

// Placeholder photos that always load: <Photo seed="laptop" w={800} h={500} alt="…" />
export function Photo({ seed = "app", w = 800, h = 500, alt = "", className }) {
  return <img src={`https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`} alt={alt} loading="lazy" className={cn("h-full w-full object-cover", className)} />;
}
