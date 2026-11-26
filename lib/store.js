import { q } from './db.js';
import { defaultProfile, computeState } from './plan.js';
import { addDays } from './util.js';

export async function getProfile(today) {
  const rows = await q('SELECT data FROM profile WHERE id = 1');
  // profiles saved before first-run setup existed count as set up
  if (rows.length) return { ...defaultProfile(today), setupDone: true, ...rows[0].data, goal: { ...defaultProfile(today).goal, ...rows[0].data.goal } };
  const p = defaultProfile(today);
  await q('INSERT INTO profile (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(p)]);
  return p;
}

export async function saveProfile(p) {
  await q('INSERT INTO profile (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()', [JSON.stringify(p)]);
}

export async function entriesSince(day) {
  return q('SELECT id, day, kind, data, created_at FROM entries WHERE day >= $1 ORDER BY day, id', [day]);
}

export async function allWeights() {
  const rows = await q(`SELECT id, day, data FROM entries WHERE kind = 'weight' ORDER BY day, id`);
  return rows.map((r) => ({ id: r.id, day: r.day, kg: Number(r.data.kg), bodyFatPct: r.data.body_fat_pct ?? null }));
}

export async function addEntry(day, kind, data) {
  const rows = await q('INSERT INTO entries (day, kind, data) VALUES ($1, $2, $3) RETURNING id', [day, kind, JSON.stringify(data)]);
  return rows[0].id;
}

export async function deleteEntry(id) {
  await q('DELETE FROM entries WHERE id = $1', [id]);
}

export async function loadState(today, daysBack = 21) {
  const profile = await getProfile(today);
  const [entries, weights] = await Promise.all([entriesSince(addDays(today, -daysBack)), allWeights()]);
  let state = computeState({ profile, entries, weights, today });
  // Recomp until abs (target body fat) at this weight, then lean bulk from there.
  // Needs real weigh-ins behind the estimate, not just the model ticking forward.
  const recentWeighIns = weights.filter((w) => w.day >= addDays(today, -21)).length;
  if (profile.goal.mode === 'recomp' && recentWeighIns >= 3 && state.est.bodyFatPct <= profile.goal.targetBodyFatPct) {
    profile.goal = { ...profile.goal, mode: 'bulk', pace: 'moderate', switchedOn: today };
    await saveProfile(profile);
    state = computeState({ profile, entries, weights, today });
  }
  const seen = new Set();
  state.recentFoods = entries.filter((e) => e.kind === 'food' && e.day >= addDays(today, -14)).reverse()
    .map((e) => String(e.data?.name || '').trim()).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, 30);
  return { state, entries, weights, profile };
}
