// Starter sign-in / sign-up page. Agents don't edit this file.
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, saveLogin } from "../lib/api.js";
import { Button, Card, ErrorNote, Field, Input } from "../components/ui.jsx";
import site from "../site.js";

export const route = "/login";

export default function Login() {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = mode === "login" ? { email: form.email, password: form.password } : form;
      saveLogin(await api(`/api/auth/${mode === "login" ? "login" : "register"}`, { method: "POST", body }));
      navigate(params.get("next") || "/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <Card className="space-y-6 p-8">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold">{mode === "login" ? `Welcome back to ${site.name}` : `Join ${site.name}`}</h1>
          <p className="text-muted">{mode === "login" ? "Sign in to continue." : "It takes less than a minute."}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === "register" && <Field label="Name"><Input value={form.name} onChange={set("name")} required /></Field>}
          <Field label="Email"><Input type="email" value={form.email} onChange={set("email")} required /></Field>
          <Field label="Password"><Input type="password" value={form.password} onChange={set("password")} required minLength={6} /></Field>
          <ErrorNote>{error}</ErrorNote>
          <Button className="w-full" loading={busy}>{mode === "login" ? "Sign in" : "Create account"}</Button>
        </form>
        <p className="text-center text-sm text-muted">
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button className="font-semibold text-brand" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Create an account" : "Sign in"}</button>
        </p>
      </Card>
    </div>
  );
}
