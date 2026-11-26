import { q } from '../lib/db.js';
import { loadState } from '../lib/store.js';
import { runChat, applyActions, logHeld } from '../lib/coach.js';
import { currentPlan, generateMealPlan } from '../lib/meals.js';
import { webSearch } from '../lib/search.js';
import { handle, send, readBody, tzOf, localDay, addDays } from '../lib/util.js';
import { todayPayload } from '../lib/views.js';

// Chat history is kept for a rolling 7 days. Recipes are copied to their own table and kept forever.
const cleanup = () => q(`DELETE FROM messages WHERE created_at < now() - interval '7 days'`);

async function extras(today) {
  const [recipes, plan] = await Promise.all([
    q('SELECT id, data FROM recipes ORDER BY id DESC LIMIT 40'),
    currentPlan(today),
  ]);
  return {
    recipes: recipes.map((r) => ({ id: r.id, name: r.data.name, kcal: r.data.kcal, protein: r.data.protein })),
    mealPlan: plan?.data ? {
      request: plan.data.request,
      today: (plan.data.today || []).map((m) => `${m.slot}: ${m.name} (${m.kcal} kcal)`),
      tomorrow: (plan.data.tomorrow || []).map((m) => `${m.slot}: ${m.name} (${m.kcal} kcal)`),
      treat: plan.data.treat?.name || null,
    } : null,
  };
}

// One full turn: model -> actions -> optional meal-plan regen -> save messages.
async function turn({ today, tz, text, searchResults, saveUser, held = null, since = null, declined = false }) {
  const { state, entries } = await loadState(today);
  const history = (await q(`SELECT role, content FROM messages ORDER BY id DESC LIMIT 8`)).reverse();
  const recent = entries.filter((e) => e.day >= addDays(today, -2));
  const { reply, actions } = await runChat(state, recent, history, text, { ...(await extras(today)), nowLocal: new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()), held, declined }, searchResults);
  const { changes, recipes, mealPlanRequest, pendingSearch } = await applyActions(actions, state, today, { allowSearch: !searchResults && !declined, held: searchResults || declined ? held || [] : null, since });

  let fresh = await loadState(today);
  if (mealPlanRequest !== undefined) {
    const mp = await generateMealPlan(fresh.state, tz, mealPlanRequest);
    if (mp) changes.push({ kind: 'mealplan', text: mealPlanRequest ? `Meal plan updated: “${mealPlanRequest}”` : 'Meal plan reset' });
  }
  if (saveUser) await q('INSERT INTO messages (role, content) VALUES ($1, $2)', ['user', text]);
  const meta = { changes, recipes, search: pendingSearch ? { ...pendingSearch, question: text } : null, searched: searchResults ? searchResults.map((r) => ({ title: r.title, url: r.url })) : null };
  const saved = await q('INSERT INTO messages (role, content, meta) VALUES ($1, $2, $3) RETURNING id, role, content, meta, created_at', ['assistant', reply, JSON.stringify(meta)]);
  if (changes.length) fresh = await loadState(today);
  return { message: saved[0], today: todayPayload(fresh.state, fresh.entries) };
}

export default (req, res) => handle(req, res, async () => {
  const tz = tzOf(req);
  const today = localDay(tz);
  await cleanup();

  if (req.method === 'GET') {
    const [msgs, { state, entries }] = await Promise.all([
      q('SELECT id, role, content, meta, created_at FROM messages ORDER BY id'),
      loadState(today),
    ]);
    return send(res, 200, { messages: msgs, today: todayPayload(state, entries) });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);

    // Web search permission: { searchDecision: { messageId, allow: true|false } }
    if (body.searchDecision) {
      const id = Number(body.searchDecision.messageId);
      const rows = await q('SELECT id, meta, created_at FROM messages WHERE id = $1', [id]);
      const meta = rows[0]?.meta;
      if (!meta?.search || meta.search.status !== 'pending') return send(res, 409, { error: 'That search request has expired.' });
      const allow = !!body.searchDecision.allow;
      const held = meta.search.held || [];
      meta.search.status = allow ? 'approved' : 'declined';
      await q('UPDATE messages SET meta = $2 WHERE id = $1', [id, JSON.stringify(meta)]);
      // food logged by the question's turn (to avoid duplicates) = anything after the reply before that question
      const since = (await q('SELECT max(created_at) AS t FROM messages WHERE id < $1', [id - 1]))[0]?.t || new Date(0);
      if (!allow) {
        if (held.length) {
          // declined: log the held estimates once, no AI call needed
          const changes = await logHeld(held);
          const saved = (await q('INSERT INTO messages (role, content, meta) VALUES ($1, $2, $3) RETURNING id, role, content, meta, created_at', ['assistant', 'Logged with my estimates.', JSON.stringify({ changes })]))[0];
          const { state, entries } = await loadState(today);
          return send(res, 200, { declined: true, message: saved, today: todayPayload(state, entries) });
        }
        // nothing was held (the model didn't estimate it yet): ask for estimates now
        return send(res, 200, { declined: true, ...(await turn({ today, tz, text: meta.search.question, saveUser: false, held: [], since, declined: true })) });
      }
      let results;
      try { results = await webSearch(meta.search.query); }
      catch (e) {
        // search failed: don't lose the food, log the estimates and pass the error on
        if (held.length) { await logHeld(held); meta.search.held = []; await q('UPDATE messages SET meta = $2 WHERE id = $1', [id, JSON.stringify(meta)]); }
        throw e;
      }
      if (process.env.DEBUG_AI === '1') console.log('[search]', meta.search.query, JSON.stringify(results).slice(0, 3000));
      let out;
      try { out = await turn({ today, tz, text: meta.search.question, searchResults: results, saveUser: false, held, since }); }
      catch (e) {
        // AI failed (e.g. free-tier limit): nothing was logged, so reopen the card to try again
        meta.search.status = 'pending';
        await q('UPDATE messages SET meta = $2 WHERE id = $1', [id, JSON.stringify(meta)]);
        throw e;
      }
      return send(res, 200, out);
    }

    const text = String(body.message || '').trim().slice(0, 2000);
    if (!text) return send(res, 400, { error: 'Empty message' });
    return send(res, 200, await turn({ today, tz, text, saveUser: true }));
  }

  send(res, 405, { error: 'Method not allowed' });
});
