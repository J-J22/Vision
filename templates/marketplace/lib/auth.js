import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, 32);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export function createSession(userId) {
  const token = randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, userId);
  return token;
}

function userFromRequest(req) {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  return db
    .prepare("SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?")
    .get(token) ?? null;
}

// Sets req.user or responds 401
export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: "Log in first" });
  req.user = user;
  next();
}

// Sets req.user when a valid token is sent, otherwise continues with req.user = null
export function optionalAuth(req, res, next) {
  req.user = userFromRequest(req);
  next();
}
