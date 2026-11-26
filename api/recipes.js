import { q } from '../lib/db.js';
import { loadState } from '../lib/store.js';
import { mealContext, mealSignature, currentPlan, generateMealPlan } from '../lib/meals.js';
import { handle, send, readBody, tzOf, localDay } from '../lib/util.js';

export default (req, res) => handle(req, res, async () => {
  const tz = tzOf(req);
  const today = localDay(tz);
  const url = new URL(req.url, 'http://x');

  if (req.method === 'DELETE') {
    await q('DELETE FROM recipes WHERE id = $1', [Number(url.searchParams.get('id'))]);
    return send(res, 200, { ok: true });
  }

  const { state } = await loadState(today);

  if (req.method === 'GET') {
    const ctx = mealContext(state, tz);
    if (!state.recentFoods?.length) {
      await q('DELETE FROM meal_plans');
      const saved = await q('SELECT id, data, created_at FROM recipes ORDER BY id DESC LIMIT 60');
      return send(res, 200, { plan: null, generatedAt: null, stale: false, needsFood: true, context: ctx, treats: state.treats, saved: saved.map((r) => ({ id: r.id, ...r.data, created_at: r.created_at })) });
    }
    const [plan, saved] = await Promise.all([
      currentPlan(today),
      q('SELECT id, data, created_at FROM recipes ORDER BY id DESC LIMIT 60'),
    ]);
    return send(res, 200, {
      plan: plan?.data || null,
      generatedAt: plan?.created_at || null,
      stale: !plan || plan.signature !== mealSignature(ctx),
      context: ctx,
      treats: state.treats,
      saved: saved.map((r) => ({ id: r.id, ...r.data, created_at: r.created_at })),
    });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    if (body.save && body.save.name) {
      const rows = await q('INSERT INTO recipes (data) VALUES ($1) RETURNING id', [JSON.stringify({ ...body.save, source: 'plan' })]);
      return send(res, 200, { id: rows[0].id });
    }
    const plan = await generateMealPlan(state, tz, body.request);
    return send(res, 200, { plan, generatedAt: new Date().toISOString(), stale: false, context: mealContext(state, tz) });
  }

  send(res, 405, { error: 'Method not allowed' });
});
