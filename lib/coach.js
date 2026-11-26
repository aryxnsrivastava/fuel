// Turns chat messages into structured data via Groq, then applies the actions.
import { q } from './db.js';
import { groqJSON } from './groq.js';
import { addEntry, deleteEntry, saveProfile } from './store.js';
import { workoutKcal, commuteKcal, sugarLimitOf, sugarMaxOf } from './plan.js';
import { addDays, clamp, isDay, num, weekday } from './util.js';

const ACTIONS_SPEC = `Return ONLY a JSON object: {"reply": string, "actions": [ ... ]}

Action types (include only what the message calls for; one message can have several):
- {"type":"log_food","date":"YYYY-MM-DD","items":[{"name":str,"kcal":num,"protein":num,"carbs":num,"fat":num,"sugar":num,"sweet":bool,"time":"HH:MM"|null,"brand":str|null}]}  (brand = the restaurant, chain, café or packaged-product brand they named, e.g. "Tim Hortons", "Domino's", "Indomie"; null for home cooking)  (sugar = ADDED/free sugar g: syrups, sweets, sweet drinks, sauces, juice; NOT natural sugar in plain fruit, milk or veg)
- {"type":"log_workout","time":"HH:MM"|null,"date":"YYYY-MM-DD","workout_type":"gym|swim|walk|run|cycle|sport|other","description":str,"minutes":num|null,"distance_km":num|null,"intensity":"light|moderate|hard","commute":bool}
- {"type":"log_weight","date":"YYYY-MM-DD","kg":num,"body_fat_pct":num|null}
- {"type":"plan_activity","date":"YYYY-MM-DD","activities":[{"workout_type":str,"minutes":num|null,"distance_km":num|null,"intensity":str}],"commute":bool}  (future plans, or rest days with an empty list)
- {"type":"delete_entry","id":num}  (to fix or undo a logged entry. To correct one, delete it and log the corrected version)
- {"type":"update_pantry","add":[str],"remove":[str],"clear":bool}
- {"type":"update_preferences","likes_add":[str],"likes_remove":[str],"dislikes_add":[str],"dislikes_remove":[str],"cuisines_add":[str]}
- {"type":"save_recipe","recipe":{"name":str,"servings":num,"time_min":num,"kcal":num,"protein":num,"carbs":num,"fat":num,"ingredients":[str],"steps":[str],"tags":[str]}}  (macros are PER SERVING)
- {"type":"update_goal","mode":"cut|recomp|bulk"|null,"pace":"steady|moderate|aggressive"|null,"target_body_fat_pct":num|null,"target_weight_kg":num|null}
- {"type":"edit_entry","id":num,"date":"YYYY-MM-DD"|null,"fields":{...}}  (change any logged entry in place: food fields name/kcal/protein/carbs/fat/sugar/sweet; workout fields workout_type/description/minutes/distance_km/intensity/commute; weight fields kg/body_fat_pct)
- {"type":"update_settings","weekly_treat_kcal":num|null,"sugar_limit_g":num|null,"commute_km_one_way":num|null,"protein_per_kg_ffm":num|null,"body_fat_pct":num|null,"current_weight_kg":num|null,"height_cm":num|null,"training_split":str|null,"sessions_per_week":num|null,"sex":"male"|"female"|null,"about":str|null}  (about = short free-text bio: who they are, city, gym, schedule, where they shop)
- {"type":"update_recipe","id":num,"recipe":{...any recipe fields to change}}  /  {"type":"delete_recipe","id":num}
- {"type":"update_meal_plan","request":str}  (regenerate the Recipes-page plan for today and tomorrow following this instruction, e.g. "swap tonight's dinner for butter chicken", "no cooking tomorrow". Use "" to reset to default.)
- {"type":"request_web_search","query":str,"reason":str}  (Use it whenever they name a restaurant, chain, café, brand or packaged product (e.g. "Domino's", "Indomie", "Chips Ahoy", "Tim Hortons"), since published nutrition beats a guess. ALWAYS log your best estimate in the same response anyway, so nothing is lost if they decline. One search per message: combine everything into one query naming the place/brand, item, size and "nutrition" or "calories" (add the city from about_user for local places). They must approve it; end the reply with a short "Want me to check the real numbers?". Skip it for generic home food.)`;

const RULES = `Rules:
- FOOD: Estimate realistic portions, and lean slightly HIGH on calories (+10%) because people under-report oil, sauces and drinks. Split a meal into its components. Mark desserts, candy, pastries, sweet drinks and ice cream as sweet:true. If a portion is vague, assume a normal restaurant or home portion and say your assumption in a few words.
- WORKOUTS: Use the user's own description. Never inflate it. If they don't give a duration, use null and the server picks a conservative default. Gym or swim sessions imply walking to the gym and back (commute:true) unless they say they drove or bused, or settings.commute_km_one_way is 0. A swim of 2-3 km at a steady pace is "moderate". Don't log the walk separately as its own workout.
- TIME: set "time" on EACH food item and workout (24h, their local time, see now_local_time) whenever they say or clearly implies it ("lunch at 1", "just now" = now_local_time, "this morning" = 09:00). Otherwise null.
- DATES: Today is {{today}} ({{weekday}}). Resolve "yesterday", "last night", "tomorrow" and weekdays to dates. Never log food or workouts in the future. Future stuff goes in plan_activity.
- WEIGHT: Only log a weigh-in if they state a number.
- RECIPES: If they ask for a recipe or "what can I make", give it in "reply" briefly and ALSO include save_recipe with full structured details. Make recipes a busy person on a budget would actually cook: cheap grocery-store ingredients, at most ~8 ingredients, one pan / pot, sheet tray, microwave or air fryer, under 30 min, batch-cookable where possible. Prefer their pantry and liked cuisines. Hit protein. Keep it tasty, never bland diet food.
- If they mention ingredients they have or bought, update_pantry. If they mention foods they love or hate, update_preferences.
- REPLY: You are a tough, no-nonsense coach texting them. Blunt and SHORT: 1–2 sentences, under 40 words, never a cheerleader or yes-man. After logging, don't repeat the items (the app shows them). Just say where today stands, e.g. "1,450/2,300 kcal, 80 g protein to go." If they're off track (over calories, protein short, skipped a session, vague logging, too many treats), say so plainly and tell them the exact fix for the rest of today. Praise only when it's earned, and keep it to a few words. No markdown headers, no emojis spam, no moral lectures about food. Sweets inside the weekly budget are part of the plan and not a failure.
- EDITING: Logging corrections (entries, portions, dates, recipes, pantry, preferences) are always fine. Do them and confirm briefly.
- GOAL PATH: recomp at maintenance until they have visible abs at roughly their current weight, THEN lean bulk. If they say abs are clearly visible now (or gives a body fat at/below target), log it (log_weight with body_fat_pct if given) and switch with update_goal mode "bulk", pace "moderate". Don't switch to bulk earlier just because they want to eat more.
- SUGAR: strict. Daily added-sugar cap is today_target.sugar_max_g (never above the AHA cap: 36 g men, 25 g women). Estimate sugar for every food item (cookies ~5 g each, a can of pop ~39 g, Indomie ~3 g, pizza ~4 g/slice). If a log pushes today over the cap, say it bluntly with the number and that sweets are done for today. Refuse any request to raise the sugar cap; lowering it is fine.
- DISCIPLINE GATE for goal, settings and meal-plan changes: apply them ONLY if they stay inside evidence-based ranges and serve the physique goal. Cut pace 0.5–1.0% BW/week, bulk 0.25–0.5%/week, protein ≥2.3 g/kg lean mass while cutting, energy availability ≥30 kcal/kg lean mass, treats ≤ ~2000 kcal/week, lifting ≥3x/week. REFUSE (no action, push back in reply, offer the closest version that fits) for things like crash diets, "1500 kcal to get abs fast", cheat weekends, dropping protein, lowering the target body fat just to feel good, inflating workout estimates, raising the treat budget at all (the chat can only lower it; tell them they can raise it themselves on the Plan page if they really must), or swapping the plan to junk that blows the targets. If they want a burger or pizza, fit a version of it into the numbers instead. Change the goal only for a real reason: target reached, injury, illness, exams, or real weigh-in data showing the plan is off. Then do it and say why it's justified.
- If the message is just a question, answer it with actions: [].`;

export function buildSystem(state, recentEntries, extra = {}) {
  const s = state;
  const t = s.todayState;
  const p = s.profile;
  const ctx = {
    today: s.today,
    now_local_time: extra.nowLocal || null,
    about_user: p.about || null,
    profile: {
      sex: p.sex || null, height_cm: p.heightCm, sessions_per_week_planned: p.sessionsPerWeek,
      est_weight_kg: s.est.weightKg, est_body_fat_pct: s.est.bodyFatPct,
      goal: p.goal, training: p.split, training_age: p.trainingAge,
      cuisines: p.cuisines, likes: p.likes, dislikes: p.dislikes, pantry: p.pantry,
    },
    settings: { weekly_treat_kcal: p.weeklyTreatKcal, commute_km_one_way: p.commuteKmOneWay, protein_per_kg_ffm: s.proteinPerKgFFM },
    today_target: { kcal: t.target, protein: t.targetProtein, carbs: t.targetCarbs, fat: t.targetFat, sugar_max_g: t.sugarLimit },
    this_week: { days_left: s.week.daysLeft, sugar_allowance_g_per_day: s.week.sugarAllowance, sugar_spare_g: s.week.sugarSpare, fat_spare_g: s.week.fatSpare },
    today_rebalance: t.adjustment ? { kcal: t.adjustment, why: t.adjReason } : null,
    today_so_far: { kcal: t.kcal, protein: t.protein, fat: t.fat, sugar: t.sugar, exercise_kcal: t.exerciseKcal },
    treats_left_this_week_kcal: s.treats.left,
    recent_entries: recentEntries.slice(-25).map((e) => { const d = e.data; return e.kind === 'food' ? { id: e.id, day: e.day, food: d.name, kcal: d.kcal, p: d.protein, sugar: d.sugar, sweet: d.sweet || undefined } : e.kind === 'workout' ? { id: e.id, day: e.day, workout: d.type, desc: d.description, min: d.minutes, km: d.distance_km, int: d.intensity } : { id: e.id, day: e.day, kind: e.kind, ...d }; }),
    saved_recipes: (extra.recipes || []).slice(0, 15).map((r) => ({ id: r.id, name: r.name })),
    current_meal_plan: extra.mealPlan || null,
  };
  return `You are the coach and data-entry brain of a personal nutrition and training app for one user (who they are is in about_user). They want to hit their goal while still eating tasty food, including sweets every week.

${ACTIONS_SPEC}

${RULES.replace('{{today}}', s.today).replace('{{weekday}}', weekday(s.today))}

Current context (JSON):
${JSON.stringify(ctx)}`;
}

// Applies the model's actions. Returns a list of human-readable changes and saved recipes.
const validTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export async function applyActions(actions, state, today, { allowSearch = true } = {}) {
  const branded = []; // logged items with a named place/brand -> offer a lookup of the real numbers
  const p = structuredClone(state.profile);
  const kg = state.est.weightKg;
  const changes = [];
  const recipes = [];
  let profileDirty = false;
  let mealPlanRequest;
  let pendingSearch = null;
  const validDay = (d, allowFuture = false) => {
    if (!isDay(d)) return today;
    if (!allowFuture && d > today) return today;
    if (d < addDays(today, -14)) return today;
    return d;
  };
  const commuteDays = new Set(
    (await q(`SELECT day FROM entries WHERE kind = 'workout' AND (data->>'commute_kcal')::int > 0 AND day >= $1`, [addDays(today, -14)])).map((r) => r.day),
  );

  for (const a of Array.isArray(actions) ? actions : []) {
    try {
      switch (a.type) {
        case 'log_food': {
          const day = validDay(a.date);
          for (const it of a.items || []) {
            const item = {
              name: String(it.name || 'food').slice(0, 80),
              kcal: Math.round(clamp(num(it.kcal), 0, 3000)),
              protein: Math.round(clamp(num(it.protein), 0, 250)),
              carbs: Math.round(clamp(num(it.carbs), 0, 500)),
              fat: Math.round(clamp(num(it.fat), 0, 250)),
              sugar: Math.round(clamp(num(it.sugar), 0, 300)),
              sweet: !!it.sweet,
              ...(validTime(it.time) ? { time: it.time } : validTime(a.time) ? { time: a.time } : {}),
            };
            const id = await addEntry(day, 'food', item);
            if (it.brand && String(it.brand).trim()) branded.push(`${String(it.brand).trim()} ${item.name}`);
            changes.push({ kind: 'food', id, day, text: `${item.name}: ${item.kcal} kcal · ${item.protein}g${item.sugar >= 5 ? ` · ${item.sugar}g sugar` : ''}${item.sweet ? ' 🍫' : ''}` });
          }
          break;
        }
        case 'log_workout': {
          const day = validDay(a.date);
          const w = {
            type: a.workout_type || a.type_of || 'other',
            description: String(a.description || '').slice(0, 120),
            minutes: a.minutes ? clamp(num(a.minutes), 5, 180) : null,
            distance_km: a.distance_km ? clamp(num(a.distance_km), 0, 20) : null,
            intensity: ['light', 'moderate', 'hard'].includes(a.intensity) ? a.intensity : 'moderate',
            ...(validTime(a.time) ? { time: a.time } : {}),
          };
          w.kcal = workoutKcal(w, kg, p.workoutFactor);
          w.commute_kcal = 0;
          if (a.commute !== false && ['gym', 'swim'].includes(w.type) && !commuteDays.has(day)) {
            w.commute_kcal = commuteKcal(p, kg);
            commuteDays.add(day);
          }
          const id = await addEntry(day, 'workout', w);
          changes.push({ kind: 'workout', id, day, text: `${w.type}${w.description ? ` (${w.description})` : ''}: −${w.kcal + w.commute_kcal} kcal` });
          break;
        }
        case 'log_weight': {
          const day = validDay(a.date);
          const kgv = num(a.kg);
          if (kgv < 40 || kgv > 150) break;
          const bf = a.body_fat_pct ? clamp(num(a.body_fat_pct), 5, 40) : null;
          const id = await addEntry(day, 'weight', { kg: kgv, body_fat_pct: bf });
          if (bf) { p.bodyFatPct = bf; p.bodyFatRefWeightKg = kgv; p.bodyFatRefDay = day; profileDirty = true; }
          changes.push({ kind: 'weight', id, day, text: `Weigh-in: ${kgv} kg${bf ? `, ${bf}% BF` : ''}` });
          break;
        }
        case 'plan_activity': {
          const day = validDay(a.date, true);
          if (day < today) break;
          const acts = (a.activities || []).map((x) => ({ type: x.workout_type || x.type || 'other', minutes: x.minutes || null, distance_km: x.distance_km || null, intensity: x.intensity || 'moderate' }));
          await q(`DELETE FROM entries WHERE kind = 'plan' AND day = $1`, [day]);
          const id = await addEntry(day, 'plan', { activities: acts, commute: a.commute !== false });
          changes.push({ kind: 'plan', id, day, text: `Plan for ${weekday(day)}: ${acts.length ? acts.map((x) => x.type).join(' + ') : 'rest day'}` });
          break;
        }
        case 'delete_entry': {
          const id = Math.round(num(a.id));
          if (id > 0) { await deleteEntry(id); changes.push({ kind: 'delete', id, text: `Removed entry #${id}` }); }
          break;
        }
        case 'update_pantry': {
          const norm = (x) => String(x).trim().toLowerCase();
          let pan = a.clear ? [] : [...p.pantry];
          const rm = new Set((a.remove || []).map(norm));
          pan = pan.filter((x) => !rm.has(norm(x)));
          for (const x of a.add || []) if (!pan.some((y) => norm(y) === norm(x))) pan.push(String(x).trim());
          p.pantry = pan.slice(0, 80); profileDirty = true;
          changes.push({ kind: 'pantry', text: `Pantry: ${p.pantry.length} items` });
          break;
        }
        case 'update_preferences': {
          const merge = (arr, add = [], rm = []) => {
            const r = new Set(rm.map((x) => x.toLowerCase()));
            const out = arr.filter((x) => !r.has(x.toLowerCase()));
            for (const x of add) if (!out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x);
            return out.slice(0, 60);
          };
          p.likes = merge(p.likes, a.likes_add, a.likes_remove);
          p.dislikes = merge(p.dislikes, a.dislikes_add, a.dislikes_remove);
          p.cuisines = merge(p.cuisines, a.cuisines_add, []);
          profileDirty = true;
          changes.push({ kind: 'prefs', text: 'Food preferences updated' });
          break;
        }
        case 'save_recipe': {
          const r = a.recipe || {};
          if (!r.name) break;
          const rec = {
            name: String(r.name).slice(0, 100), servings: num(r.servings, 1), time_min: num(r.time_min, 0),
            kcal: Math.round(num(r.kcal)), protein: Math.round(num(r.protein)), carbs: Math.round(num(r.carbs)), fat: Math.round(num(r.fat)),
            ...(r.sugar != null ? { sugar: Math.round(num(r.sugar)) } : {}),
            ingredients: (r.ingredients || []).map(String).slice(0, 40), steps: (r.steps || []).map(String).slice(0, 30), tags: (r.tags || []).map(String).slice(0, 8),
            source: 'chat',
          };
          const rows = await q('INSERT INTO recipes (data) VALUES ($1) RETURNING id', [JSON.stringify(rec)]);
          recipes.push({ id: rows[0].id, ...rec });
          changes.push({ kind: 'recipe', text: `Saved recipe: ${rec.name}` });
          break;
        }
        case 'update_goal': {
          if (['cut', 'recomp', 'bulk'].includes(a.mode)) p.goal.mode = a.mode;
          if (['steady', 'moderate', 'aggressive'].includes(a.pace)) p.goal.pace = a.pace;
          if (a.target_body_fat_pct) p.goal.targetBodyFatPct = clamp(num(a.target_body_fat_pct), 8, 25);
          if (a.target_weight_kg) p.goal.targetWeightKg = clamp(num(a.target_weight_kg), 50, 110);
          profileDirty = true;
          changes.push({ kind: 'goal', text: `Goal: ${p.goal.mode}, ${p.goal.pace}` });
          break;
        }
        case 'edit_entry': {
          const id = Math.round(num(a.id));
          const rows = await q('SELECT id, day, kind, data FROM entries WHERE id = $1', [id]);
          if (!rows.length) break;
          const e = rows[0], f = a.fields || {};
          const d = { ...e.data };
          if (e.kind === 'food') {
            if (f.name) d.name = String(f.name).slice(0, 80);
            for (const k of ['kcal', 'protein', 'carbs', 'fat']) if (f[k] != null) d[k] = Math.round(clamp(num(f[k]), 0, 3000));
            if (f.sweet != null) d.sweet = !!f.sweet;
            if (f.sugar != null) d.sugar = Math.round(clamp(num(f.sugar), 0, 300));
          } else if (e.kind === 'workout') {
            if (f.workout_type || f.type) d.type = f.workout_type || f.type;
            if (f.description) d.description = String(f.description).slice(0, 120);
            if (f.minutes != null) d.minutes = clamp(num(f.minutes), 5, 180);
            if (f.distance_km != null) d.distance_km = clamp(num(f.distance_km), 0, 20);
            if (['light', 'moderate', 'hard'].includes(f.intensity)) d.intensity = f.intensity;
            d.kcal = workoutKcal(d, kg, p.workoutFactor);
            if (f.commute === false) d.commute_kcal = 0;
            if (f.commute === true && !d.commute_kcal) d.commute_kcal = commuteKcal(p, kg);
          } else if (e.kind === 'weight') {
            if (f.kg != null) d.kg = clamp(num(f.kg), 40, 150);
            if (f.body_fat_pct != null) d.body_fat_pct = clamp(num(f.body_fat_pct), 5, 40);
          }
          const day = isDay(a.date) ? validDay(a.date, e.kind === 'plan') : e.day;
          await q('UPDATE entries SET data = $2, day = $3 WHERE id = $1', [id, JSON.stringify(d), day]);
          changes.push({ kind: 'edit', id, day, text: `Updated #${id}: ${d.name || d.type || (d.kg ? d.kg + ' kg' : e.kind)}${d.kcal != null ? ` → ${d.kcal} kcal` : ''}` });
          break;
        }
        case 'update_settings': {
          // the chat may only LOWER the treat budget; raising it is a deliberate choice on the Plan page
          if (a.sugar_limit_g != null) p.sugarLimitG = Math.min(sugarLimitOf(p), clamp(num(a.sugar_limit_g), 15, sugarMaxOf(p))); // lower only
          if (a.weekly_treat_kcal != null) p.weeklyTreatKcal = Math.min(p.weeklyTreatKcal, clamp(num(a.weekly_treat_kcal), 0, 2000));
          if (a.commute_km_one_way != null) p.commuteKmOneWay = clamp(num(a.commute_km_one_way), 0, 10);
          if (a.protein_per_kg_ffm != null) p.proteinPerKgFFM = clamp(num(a.protein_per_kg_ffm), 1.8, 3.1);
          if (a.height_cm != null) p.heightCm = clamp(num(a.height_cm), 140, 220);
          if (a.training_split) p.split = String(a.training_split).slice(0, 200);
          if (a.about) p.about = String(a.about).slice(0, 500);
          if (a.sessions_per_week != null) p.sessionsPerWeek = clamp(Math.round(num(a.sessions_per_week)), 0, 14);
          if (['male', 'female'].includes(a.sex)) p.sex = a.sex;
          if (a.body_fat_pct != null) {
            p.bodyFatPct = clamp(num(a.body_fat_pct), 5, 40);
            p.bodyFatRefWeightKg = a.current_weight_kg ? clamp(num(a.current_weight_kg), 40, 150) : kg;
            p.bodyFatRefDay = today;
          }
          profileDirty = true;
          changes.push({ kind: 'settings', text: 'Settings updated' });
          break;
        }
        case 'update_recipe': {
          const id = Math.round(num(a.id));
          const rows = await q('SELECT data FROM recipes WHERE id = $1', [id]);
          if (!rows.length) break;
          const merged = { ...rows[0].data, ...(a.recipe || {}) };
          await q('UPDATE recipes SET data = $2 WHERE id = $1', [id, JSON.stringify(merged)]);
          recipes.push({ id, ...merged });
          changes.push({ kind: 'recipe', text: `Updated recipe: ${merged.name}` });
          break;
        }
        case 'delete_recipe': {
          const id = Math.round(num(a.id));
          await q('DELETE FROM recipes WHERE id = $1', [id]);
          changes.push({ kind: 'recipe', text: `Deleted recipe #${id}` });
          break;
        }
        case 'update_meal_plan': {
          mealPlanRequest = String(a.request ?? '');
          break;
        }
        case 'request_web_search': {
          if (a.query) pendingSearch = { query: String(a.query).slice(0, 300), reason: String(a.reason || '').slice(0, 200), status: 'pending' };
          break;
        }
        default: break;
      }
    } catch (e) { console.error('action failed', a, e); }
  }
  if (profileDirty) await saveProfile(p);
  if (!allowSearch) pendingSearch = null;
  else if (!pendingSearch && branded.length) {
    pendingSearch = { query: `${[...new Set(branded)].slice(0, 4).join(', ')} nutrition calories protein sugar`.slice(0, 300), reason: 'Use published nutrition instead of my estimate', status: 'pending' };
  }
  return { changes, recipes, mealPlanRequest, pendingSearch };
}

// Offline mock so the pipeline can be tested without a Groq key (MOCK_AI=1).
export function mockChat(messages) {
  const text = messages.at(-1).content.toLowerCase();
  const today = (messages[0].content.match(/Today is (\d{4}-\d{2}-\d{2})/) || [])[1];
  const actions = [];
  if (/ate|had|lunch|dinner|breakfast/.test(text)) actions.push({ type: 'log_food', date: today, items: [{ name: 'Chicken biryani', kcal: 750, protein: 38, carbs: 90, fat: 24, sugar: 4, sweet: false }, { name: 'Gulab jamun (2)', kcal: 300, protein: 4, carbs: 50, fat: 10, sugar: 40, sweet: true }] });
  if (/swim/.test(text)) actions.push({ type: 'log_workout', date: today, workout_type: 'swim', description: '2.5 km freestyle', distance_km: 2.5, minutes: null, intensity: 'moderate', commute: true });
  if (/gym|push|pull/.test(text)) actions.push({ type: 'log_workout', date: today, workout_type: 'gym', description: 'push day', minutes: 70, intensity: 'moderate', commute: true });
  const w = text.match(/(\d{2}(\.\d)?)\s?kg/); if (w) actions.push({ type: 'log_weight', date: today, kg: Number(w[1]) });
  if (/recipe/.test(text)) actions.push({ type: 'save_recipe', recipe: { name: 'Paneer tikka wrap', servings: 1, time_min: 20, kcal: 620, protein: 42, carbs: 55, fat: 24, ingredients: ['150 g paneer (light)', '1 large wrap', '100 g Greek yogurt', 'tikka spice', 'onion, pepper'], steps: ['Marinate paneer in yogurt + spice', 'Sear 6 min', 'Wrap with veg'], tags: ['South Asian', 'high protein'] } });
  if (/mcdonald|restaurant|look ?up/.test(text) && !messages[0].content.includes('APPROVED a web search')) actions.push({ type: 'request_web_search', query: 'McDonalds Big Mac nutrition Canada', reason: 'Exact menu calories' });
  if (/swap|change (the )?plan/.test(text)) actions.push({ type: 'update_meal_plan', request: message_text(text) });
  return { reply: `(mock) Did ${actions.length} thing(s).`, actions };
}

// searchResults: when the user approved a web search, the results are passed in and the
// model must answer from them (and may not request another search).
const message_text = (t) => t.slice(0, 200);

export async function runChat(state, recentEntries, history, message, extra = {}, searchResults = null) {
  let system = buildSystem(state, recentEntries, extra);
  if (searchResults) {
    system += `\n\nThe user APPROVED a web search for their previous message. Anything from that message already in recent_entries is ALREADY LOGGED: do not log it again. Correct the estimates you logged with edit_entry using the published numbers (kcal, protein, carbs, fat, sugar, scaled to the portion they had). Read the raw snippets carefully: nutrition guides are often flattened tables like "Honey Cruller 80g 320 19 9 ..." (item, serving, kcal, fat, ...); use the column headers in the snippet to map numbers. Only change an entry when the published numbers differ from yours; don't send no-op edits. If the results really don't cover an item (common for small local places), keep the estimate and say so in a few words. Cite the source name briefly and do NOT request another search. Results:\n${JSON.stringify(searchResults)}`;
  }
  const msgs = [{ role: 'system', content: system }, ...history.slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 600) })), { role: 'user', content: message }];
  const out = await groqJSON(msgs, { temperature: 0.3, maxTokens: 1400, mock: mockChat, textReply: true });
  let { reply, actions } = normalizeTurn(out);
  if (searchResults) actions = actions.filter((a) => a.type !== 'request_web_search');
  if (!reply) reply = actions.length ? 'Logged.' : "Didn't catch that. Say it again, simpler.";
  return { reply, actions };
}

// Models sometimes wrap the answer in an array or spill actions outside "actions".
// Walk whatever came back and collect the reply plus every action-shaped object.
export function normalizeTurn(out) {
  let reply = '';
  const actions = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (typeof v.reply === 'string' && !reply) reply = v.reply.trim();
    if (typeof v.type === 'string') actions.push(v);
    if (v.actions) walk(v.actions);
  };
  walk(out);
  return { reply, actions };
}
