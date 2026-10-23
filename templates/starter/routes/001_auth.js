import { hashPassword, checkPassword, createSession } from "../lib/auth.js";

export default function (app, { db, requireAuth }) {
  app.post("/api/auth/register", (req, res) => {
    const { email, password, name } = req.body ?? {};
    if (typeof email !== "string" || !email.includes("@")) return res.status(400).json({ error: "Enter a valid email" });
    if (typeof password !== "string" || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const displayName = typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : email.split("@")[0];
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email.toLowerCase())) {
      return res.status(409).json({ error: "That email is already registered" });
    }
    const { lastInsertRowid } = db
      .prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)")
      .run(email.toLowerCase(), displayName, hashPassword(password));
    const user = { id: Number(lastInsertRowid), email: email.toLowerCase(), name: displayName, role: "member" };
    res.status(201).json({ token: createSession(user.id), user });
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body ?? {};
    const row = typeof email === "string" ? db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) : null;
    if (!row || typeof password !== "string" || !checkPassword(password, row.password_hash)) {
      return res.status(401).json({ error: "Wrong email or password" });
    }
    const user = { id: row.id, email: row.email, name: row.name, role: row.role };
    res.json({ token: createSession(user.id), user });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));
}
