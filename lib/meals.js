// Meal plan generation (used by the Recipes page and by the chat when asked to change the plan).
import { q } from './db.js';
import { groqJSON } from './groq.js';
import { hash, num } from './util.js';

export function localHour(tz) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
}

function slotsFor(hour, remainingKcal) {
  if (hour < 10) return ['breakfast', 'lunch', 'snack', 'dinner'];
  if (hour < 14) return ['lunch', 'snack', 'dinner'];
  if (hour < 17) return ['snack', 'dinner'];
  if (hour < 21) return ['dinner'];
  return remainingKcal > 300 ? ['late snack'] : [];
}

export function mealContext(state, tz) {
  const t = state.todayState, n = state.tomorrowState, p = state.profile;
  const hour = localHour(tz);
  return {
    now_local_hour: hour,
    slots_today: slotsFor(hour, t.remaining.kcal),
    today: {
      target: { kcal: t.target, protein: t.targetProtein, carbs: t.targetCarbs, fat: t.targetFat },
      eaten: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat },
      remaining: t.remaining,
      sugar_left_g: Math.max(0, t.remaining.sugar),
      exercise_kcal: t.exerciseUsed, exercise_basis: t.exerciseBasis,
    },
    sugar_max_g: t.sugarLimit,
    tomorrow: {
      weekday: n.weekday,
      target: { kcal: n.target, protein: n.targetProtein, carbs: n.targetCarbs, fat: n.targetFat },
      planned_activity: n.planned, exercise_basis: n.exerciseBasis,
    },
    last_3_days: state.past3,
    rebalance_kcal_today: t.adjustment,
    treats_left_this_week_kcal: state.treats.left,
    about_user: p.about || null, training: p.split,
    goal: p.goal,
    pantry: p.pantry, cuisines: p.cuisines, likes: p.likes, dislikes: p.dislikes,
    foods_he_actually_eats: state.recentFoods || [],
  };
}

// slot list changes during the day; don't make the plan stale just because the hour ticked
export const mealSignature = (ctx) => hash(JSON.stringify({ ...ctx, now_local_hour: undefined, slots_today: ctx.slots_today.length }));

const PROMPT = `You plan meals for one person. Who they are, where they live and how they train is in about_user and training (goal mode is in the context). Non-negotiable: food must be TASTY (real flavour: spices, sauces, crunch), not bland diet food. He likes sweet treats every week.

Using the context JSON, return ONLY JSON:
{"headline": str (max 6 words, e.g. "Swim day: carbs up"),
 "why": str (ONE blunt sentence, max 20 words, linking the last 3 days and today's training to these targets. If he overate or under-trained recently, say so plainly),
 "today": [meal], "tomorrow": [meal], "treat": meal|null}
meal = {"slot": str, "name": str, "kcal": num, "protein": num, "carbs": num, "fat": num, "sugar": num (added sugar g), "time_min": num, "ingredients": [str with grams], "steps": [str, max 5 short steps], "uses_pantry": bool, "tags": [str]}

Rules:
- "today" has exactly one meal per entry in slots_today. Together they should land within ±75 kcal of today.remaining.kcal and cover today.remaining.protein. If remaining kcal is under 150, return a light high-protein option or nothing.
- "tomorrow" has breakfast, lunch, snack and dinner summing to about tomorrow.target, and hits its protein. On training days, put more carbs around the session.
- Build ONLY from what he has told you: foods_he_actually_eats, pantry, likes and his cuisines. Make leaner, higher-protein versions of the food he actually eats (e.g. he eats pizza -> a high-protein homemade pizza wrap). Basic staples (meat, eggs, rice, bread, veg, spices, sauces) are fine. NO protein powder, whey, supplements, granola, "power bowls" or health-food products unless they appear in his pantry, likes or foods. Say uses_pantry when a pantry item is used. Never use disliked foods.
- SUGAR is strict: all of today's meals + treat together must keep added sugar within today.sugar_left_g, and tomorrow's within sugar_max_g. Prefer fruit, spices and dairy for sweetness. If sugar_left_g is under 10, treat is null.
- "treat": if treats_left_this_week_kcal >= 150, one sweet he'd actually want (150-350 kcal), based on sweets in his foods or likes, fitted INSIDE the day's total. Otherwise null.
- Student-realistic: food he would ACTUALLY make. Cheap staples from a normal local grocery store (use the city and stores in about_user if given), at most ~8 ingredients, one pan / pot / sheet tray, air fryer or microwave, under 30 min. Batch-cook lunches are welcome, and so are sensible shortcuts (rotisserie chicken, frozen veg, microwave rice, store-bought naan or wraps, jarred curry paste). Steps are short and clear.
- If the user made a specific request, follow it (swap a meal, use an ingredient, a craving) but ONLY inside the targets. If the request would blow the day (e.g. "large pizza for dinner"), make a version of it that fits the numbers, and say so bluntly in "why". Never drop protein below target to fit a request.`;

function mockPlan(ctx) {
  const m = (slot, name, kcal, protein) => ({ slot, name, kcal, protein, carbs: Math.round(kcal * 0.45 / 4), fat: Math.round(kcal * 0.25 / 9), time_min: 25, ingredients: ['200 g chicken thigh', '75 g basmati rice (dry)', '1 tbsp butter chicken paste', '60 g Greek yogurt'], steps: ['Sear chicken 6 min', 'Simmer with paste + yogurt 10 min', 'Serve over rice'], uses_pantry: false, tags: ['mock'] });
  const r = Math.max(0, ctx.today.remaining.kcal), rp = Math.max(0, ctx.today.remaining.protein);
  return {
    headline: '(mock) Training day, so carbs are up', why: 'Mock plan for local testing.',
    today: ctx.slots_today.map((s, i, a) => m(s, `Butter chicken bowl ${i + 1}`, Math.round(r / a.length), Math.round(rp / a.length))),
    tomorrow: ['breakfast', 'lunch', 'snack', 'dinner'].map((s) => m(s, `Chicken shawarma ${s}`, Math.round(ctx.tomorrow.target.kcal / 4), Math.round(ctx.tomorrow.target.protein / 4))),
    treat: ctx.treats_left_this_week_kcal >= 150 ? m('treat', 'Protein kheer', 250, 20) : null,
  };
}

const cleanMeals = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && x.name).map((x) => ({
  slot: String(x.slot || ''), name: String(x.name), time_min: num(x.time_min), uses_pantry: !!x.uses_pantry,
  kcal: Math.round(num(x.kcal)), protein: Math.round(num(x.protein)), carbs: Math.round(num(x.carbs)), fat: Math.round(num(x.fat)), sugar: Math.round(num(x.sugar)),
  ingredients: (x.ingredients || []).map(String), steps: (x.steps || []).map(String), tags: (x.tags || []).map(String),
}));

export async function currentPlan(day) {
  const rows = await q('SELECT signature, data, created_at FROM meal_plans WHERE day = $1', [day]);
  return rows[0] || null;
}

// request: optional instruction ("swap dinner for something with paneer"). Kept for the day so
// automatic refreshes keep honouring it; pass request === '' to clear it.
export async function generateMealPlan(state, tz, request) {
  const day = state.today;
  if (!state.recentFoods?.length) return null; // nothing real to build on yet
  const prev = await currentPlan(day);
  const keep = request === undefined ? prev?.data?.request || '' : String(request).slice(0, 300);
  const ctx = mealContext(state, tz);
  const user = JSON.stringify(ctx) + (keep ? `\nUser's request for today's plan: ${keep}` : '') +
    (prev?.data && keep ? `\nPrevious plan (keep meals the request doesn't touch): ${JSON.stringify({ today: prev.data.today?.map((m) => m.name), tomorrow: prev.data.tomorrow?.map((m) => m.name) })}` : '');
  const out = await groqJSON([{ role: 'system', content: PROMPT }, { role: 'user', content: user }], { temperature: 0.7, maxTokens: 3000, mock: () => mockPlan(ctx) });
  const plan = {
    headline: String(out.headline || ''), why: String(out.why || ''), request: keep,
    today: cleanMeals(out.today), tomorrow: cleanMeals(out.tomorrow), treat: out.treat?.name ? cleanMeals([out.treat])[0] : null,
  };
  await q(`INSERT INTO meal_plans (day, signature, data, created_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (day) DO UPDATE SET signature = $2, data = $3, created_at = now()`, [day, mealSignature(ctx), JSON.stringify(plan)]);
  await q('DELETE FROM meal_plans WHERE day < $1', [day]);
  return plan;
}
