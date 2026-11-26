import { send, readBody, passcode, passcodeOn, safeEqual, makeSessionCookie } from '../lib/util.js';

// POST {passcode} -> sets the session cookie.  POST {logout: true} -> clears it.  GET -> lock status.
export default async (req, res) => {
  try {
    if (req.method === 'GET') return send(res, 200, { passcodeOn: passcodeOn() });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const b = await readBody(req);
    if (b.logout) { res.setHeader('Set-Cookie', makeSessionCookie(req, true)); return send(res, 200, { ok: true }); }
    if (!passcodeOn()) return send(res, 200, { ok: true });
    if (typeof b.passcode !== 'string' || !safeEqual(b.passcode.trim(), passcode())) {
      await new Promise((r) => setTimeout(r, 1500)); // slows down guessing
      return send(res, 401, { error: 'Wrong passcode' });
    }
    res.setHeader('Set-Cookie', makeSessionCookie(req));
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'Login failed' });
  }
};
