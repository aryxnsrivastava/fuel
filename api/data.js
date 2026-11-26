import { loadState, deleteEntry, getProfile, saveProfile } from '../lib/store.js';
import { todayPayload, progressPayload, planPayload, dayPayload } from '../lib/views.js';
import { currentPlan } from '../lib/meals.js';
import { handle, send, readBody, tzOf, localDay, clamp, num, passcodeOn } from '../lib/util.js';

export default (req, res) => handle(req, res, async () => {
  const today = localDay(tzOf(req));
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET') {
    const view = url.searchParams.get('view') || 'today';
    if (view === 'progress') {
      const { state, entries, weights } = await loadState(today, 365);
      return send(res, 200, progressPayload(state, entries, weights));
    }
    if (view === 'plan') {
      const { state, weights } = await loadState(today, 21);
      return send(res, 200, { ...planPayload(state, weights), passcodeOn: passcodeOn() });
    }
    if (view === 'day') {
      const { state, entries } = await loadState(today, 21);
      return send(res, 200, dayPayload(state, entries, await currentPlan(today)));
    }
    const { state, entries } = await loadState(today, 21);
    return send(res, 200, todayPayload(state, entries));
  }

  if (req.method === 'DELETE') {
    const id = Number(url.searchParams.get('id'));
    if (!id) return send(res, 400, { error: 'id required' });
    await deleteEntry(id);
    const { state, entries } = await loadState(today, 21);
    return send(res, 200, todayPayload(state, entries));
  }

  // PUT: update goals / settings / lists
  if (req.method === 'PUT') {
    const b = await readBody(req);
    const p = await getProfile(today);
    const g = b.goal || {};
    if (['cut', 'recomp', 'bulk'].includes(g.mode)) p.goal.mode = g.mode;
    if (['steady', 'moderate', 'aggressive'].includes(g.pace)) p.goal.pace = g.pace;
    if (g.targetBodyFatPct != null) p.goal.targetBodyFatPct = clamp(num(g.targetBodyFatPct, 12), 8, 25);
    if (g.targetWeightKg !== undefined) p.goal.targetWeightKg = g.targetWeightKg ? clamp(num(g.targetWeightKg), 50, 110) : null;
    if (b.bodyFatPct != null && num(b.bodyFatPct) !== p.bodyFatPct) {
      // re-anchor lean mass estimate on a new body fat reading
      p.bodyFatPct = clamp(num(b.bodyFatPct), 5, 40);
      p.bodyFatRefWeightKg = clamp(num(b.currentWeightKg, p.bodyFatRefWeightKg), 40, 150);
      p.bodyFatRefDay = today;
    }
    if (b.heightCm != null) p.heightCm = clamp(num(b.heightCm, 180), 140, 220);
    if (b.proteinPerKgFFM !== undefined) p.proteinPerKgFFM = b.proteinPerKgFFM ? clamp(num(b.proteinPerKgFFM), 1.8, 3.1) : null;
    if (b.sugarLimitG != null) p.sugarLimitG = clamp(num(b.sugarLimitG, 36), 15, 36);
    if (b.weeklyTreatKcal != null) p.weeklyTreatKcal = clamp(num(b.weeklyTreatKcal, 1400), 0, 2000);
    if (b.commuteKmOneWay != null) p.commuteKmOneWay = clamp(num(b.commuteKmOneWay, 2), 0, 10);
    if (b.workoutFactor != null) p.workoutFactor = clamp(num(b.workoutFactor, 0.8), 0.5, 1);
    for (const k of ['pantry', 'likes', 'dislikes', 'cuisines']) {
      if (Array.isArray(b[k])) p[k] = b[k].map((x) => String(x).trim()).filter(Boolean).slice(0, 80);
    }
    if (typeof b.split === 'string') p.split = b.split.slice(0, 200);
    if (typeof b.about === 'string') p.about = b.about.slice(0, 500);
    await saveProfile(p);
    const { state, weights } = await loadState(today, 21);
    return send(res, 200, { ...planPayload(state, weights), passcodeOn: passcodeOn() });
  }

  send(res, 405, { error: 'Method not allowed' });
});
