// Shared helpers for API routes.
import crypto from 'node:crypto';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// ---------- single-user lock ----------
// APP_PASSCODE is checked once at /api/login, which sets a signed HttpOnly cookie. Page scripts
// can't read that cookie, and the passcode itself is never stored in the browser.
const COOKIE = 'fuel_session';
const YEAR_S = 365 * 24 * 3600;

// tolerate stray spaces or quotes around the value (e.g. "APP_PASSCODE= abc" in a .env file)
export const passcode = () => String(process.env.APP_PASSCODE || '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
export const passcodeOn = () => !!passcode();

// signing key: passcode + the server-only database URL, so changing the passcode logs everyone out
const sessionKey = () => crypto.createHash('sha256')
  .update(`fuel-session|${passcode()}|${process.env.SESSION_SECRET || process.env.DATABASE_URL || ''}`).digest();
const sign = (v) => crypto.createHmac('sha256', sessionKey()).update(v).digest('base64url');

export function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export function makeSessionCookie(req, clear = false) {
  const exp = Date.now() + YEAR_S * 1000;
  const value = clear ? '' : `${exp}.${sign(String(exp))}`;
  const host = String(req.headers.host || '');
  const secure = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? '' : '; Secure';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : YEAR_S}${secure}`;
}

function validSession(req) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}

export function authorized(req, res) {
  if (!passcodeOn()) return true; // lock is optional
  if (validSession(req)) return true;
  // header form kept for scripts/tests (curl); the app itself never sends it
  if (req.headers['x-passcode'] && safeEqual(String(req.headers['x-passcode']).trim(), passcode())) return true;
  send(res, 401, { error: 'locked' });
  return false;
}

export function tzOf(req) {
  const tz = req.headers['x-tz'];
  try { if (tz) { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return tz; } } catch {}
  return process.env.DEFAULT_TZ || 'UTC';
}

export function localDay(tz, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(day) {
  return new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

// Monday of the week containing `day`
export function weekStart(day) {
  const d = new Date(day + 'T12:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
export const round = (v, p = 0) => { const f = 10 ** p; return Math.round(v * f) / f; };

export function isDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

export function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function handle(req, res, fn) {
  try {
    if (!authorized(req, res)) return;
    await fn();
  } catch (e) {
    console.error(e);
    send(res, e.status || 500, { error: e.publicMessage || 'Something went wrong on the server.', detail: String(e.message || e) });
  }
}
