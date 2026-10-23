// Talking to the backend. Agents don't edit this file.
import { useEffect, useState } from "react";

export async function api(path, { method = "GET", body } = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export function saveLogin({ token, user }) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
  window.dispatchEvent(new Event("auth"));
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.dispatchEvent(new Event("auth"));
}

// const { data, loading, error, reload } = useApi("/api/projects")  (pass null to skip)
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: Boolean(path), error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    api(path)
      .then((data) => live && setState({ data, loading: false, error: "" }))
      .catch((err) => live && setState({ data: null, loading: false, error: err.message }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useUser() {
  const [user, setUser] = useState(currentUser());
  useEffect(() => {
    const update = () => setUser(currentUser());
    window.addEventListener("auth", update);
    return () => window.removeEventListener("auth", update);
  }, []);
  return user;
}

export const formatPrice = (cents, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format((Number(cents) || 0) / 100);

export const formatDate = (value) => (value ? new Date(String(value).replace(" ", "T") + (String(value).includes("Z") ? "" : "Z")).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
