// All nutrition / training math. Deterministic and based on published sports-science sources
// (listed in SOURCES below and shown in the app), so numbers never drift with the AI.
import { addDays, clamp, num, round, weekStart, weekday } from './util.js';

export const SOURCES = [
  { id: 'cunningham', what: 'Resting metabolic rate = 500 + 22 × fat-free mass (kg)', cite: 'Cunningham JJ (1980) Am J Clin Nutr 33:2372. Recommended for athletes: ten Haaf & Weijs (2014) PLoS One 9:e108460; Jagim et al. (2018) Int J Exerc Sci.' },
  { id: 'pal', what: 'Non-exercise activity multiplier 1.35 (below the FAO "sedentary" PAL of 1.40–1.69, because training is added separately)', cite: 'FAO/WHO/UNU (2004) Human Energy Requirements, Food & Nutrition Technical Report 1.' },
  { id: 'compendium', what: 'Workout burn = (MET − 1) × kg × hours × 0.8. MET values from the Compendium; subtracting 1 MET avoids double-counting resting burn; the 0.8 deliberately under-counts.', cite: 'Ainsworth BE et al. (2011) Med Sci Sports Exerc 43:1575; Herrmann SD et al. (2024) J Sport Health Sci 13:6 (2024 Adult Compendium).' },
  { id: 'rate', what: 'Fat-loss pace 0.5 / 0.7 / 1.0 % of body weight per week. 0.7%/wk preserved lean mass and performance better than 1.4%/wk in athletes.', cite: 'Garthe I et al. (2011) Int J Sport Nutr Exerc Metab 21:97; Helms ER et al. (2014) J Int Soc Sports Nutr 11:20.' },
  { id: 'energy', what: '≈7700 kcal per kg of body weight lost during a cut', cite: 'Wishnofsky M (1958) Am J Clin Nutr 6:542; see Hall KD (2008) Int J Obes 32:573 for its limits (hence the self-calibration).' },
  { id: 'protein', what: 'Protein: cut 2.6 g/kg fat-free mass (range 2.3–3.1); recomp 2.4 g/kg FFM; lean bulk 2.0 g/kg FFM (≈1.6–1.8 g/kg body weight)', cite: 'Helms ER et al. (2014) Int J Sport Nutr Exerc Metab 24:127; Morton RW et al. (2018) Br J Sports Med 52:376; Jäger R et al. (2017) ISSN Position Stand, J Int Soc Sports Nutr 14:20.' },
  { id: 'fat', what: 'Fat 25% of calories on cut/bulk, 30% on recomp (range 20–35%, never below 20%)', cite: 'Thomas DT, Erdman KA, Burke LM (2016) ACSM/AND/DC Joint Position: Nutrition and Athletic Performance, Med Sci Sports Exerc 48:543.' },
  { id: 'sugar', what: 'Added/free sugar: hard cap 36 g/day (AHA limit for men, ≈5% of energy, the WHO "further benefit" level). Can be lowered, never raised.', cite: 'Johnson RK et al. (2009) AHA Scientific Statement, Circulation 120:1011; WHO (2015) Guideline: Sugars intake for adults and children.' },
  { id: 'carbs', what: 'Carbs fill the rest. 3–5 g/kg/day is the guide for ~1 h/day of moderate training; the app flags if you drop below 3 g/kg.', cite: 'Thomas, Erdman & Burke (2016), as above; Burke LM et al. (2011) J Sports Sci 29:S17.' },
  { id: 'ea', what: 'Safety floor: energy availability (intake − exercise) never below 30 kcal/kg fat-free mass/day', cite: 'Loucks AB et al. (2011) J Sports Sci 29:S7; Mountjoy M et al. (2023) IOC consensus on REDs, Br J Sports Med 57:1073.' },
  { id: 'bulk', what: 'Lean bulk gain 0.25–0.5% body weight/week (≈10–15% surplus)', cite: 'Iraki J et al. (2019) Sports 7:154; Slater GJ et al. (2019) Front Nutr 6:131.' },
  { id: 'recomp', what: 'Recomp: eat at maintenance with high protein + lifting; muscle is gained while fat drops slowly, more so if detrained ("muscle memory"). Rates used in projections are conservative model assumptions, not measured values.', cite: 'Barakat C et al. (2020) Strength Cond J 42:7; Bruusgaard JC et al. (2010) PNAS 107:15111.' },
  { id: 'adaptive', what: 'Self-calibration: after 2+ weeks of logs and weigh-ins, real maintenance = average intake − (weight trend × 7700), blended with the formula', cite: 'Standard energy-balance back-calculation; Hall KD et al. (2011) Lancet 378:826.' },
];

export function defaultProfile(today) {
  return {
    about: '',                 // free-text bio the AI reads: who you are, city, gym, schedule, shops
    heightCm: 180,
    startWeightKg: 75,
    bodyFatPct: 20,            // set your own on the Plan page; err high, not low
    bodyFatRefWeightKg: 75,
    bodyFatRefDay: today,
    goal: { mode: 'recomp', pace: 'moderate', targetBodyFatPct: 12, targetWeightKg: null },
    proteinPerKgFFM: null,     // null = use the sourced default for the mode
    sugarLimitG: 36,           // added sugar cap per day (AHA men); never above 36
    weeklyTreatKcal: 1400,     // sweets budget, already inside the daily targets
    commuteKmOneWay: 1,        // walk to the gym, one way
    walkKmh: 5.6,              // brisk walking pace
    workoutFactor: 0.8,        // under-count every workout by 20%
    nonExercisePAL: 1.35,
    split: 'push, pull, legs, swim',
    trainingAge: '~2 years, on and off',
    cuisines: ['South Asian', 'Western comfort', 'Mediterranean'],
    likes: ['sweet treats a few times a week'],
    dislikes: [],
    pantry: [],
  };
}

// ---------- energy model ----------
const PACE_PCT = { // % body weight per week (negative = loss)
  cut: { steady: -0.5, moderate: -0.7, aggressive: -1.0 },
  recomp: { steady: 0, moderate: 0, aggressive: 0 }, // eat at maintenance
  bulk: { steady: 0.25, moderate: 0.35, aggressive: 0.5 },
};
const BULK_SURPLUS = { steady: 0.08, moderate: 0.11, aggressive: 0.15 }; // fraction of maintenance
// Conservative lean-gain assumptions (kg/week) for a detrained ~2yr lifter training 4-5x/week.
const LEAN_RATE = {
  cut: { steady: 0.05, moderate: 0.03, aggressive: 0.01 },
  recomp: { steady: 0.07, moderate: 0.06, aggressive: 0.05 },
  bulk: { steady: 0.08, moderate: 0.1, aggressive: 0.11 },
};
const PROTEIN_FFM = { cut: 2.6, recomp: 2.4, bulk: 2.0 };

export const leanRateOf = (p) => LEAN_RATE[p.goal.mode]?.[p.goal.pace] ?? 0.03;
export const pacePctOf = (p) => PACE_PCT[p.goal.mode]?.[p.goal.pace] ?? -0.7;
export const proteinFFMOf = (p) => {
  const v = num(p.proteinPerKgFFM) || PROTEIN_FFM[p.goal.mode] || 2.6;
  return p.goal.mode === 'cut' ? clamp(v, 2.3, 3.1) : clamp(v, 1.8, 3.1);
};

export const sugarLimitOf = (p) => clamp(num(p.sugarLimitG, 36) || 36, 15, 36);

// daily kcal offset vs maintenance (negative = deficit)
export function energyOffset(p, kg, maintenance) {
  if (p.goal.mode === 'bulk') return Math.round(maintenance * (BULK_SURPLUS[p.goal.pace] ?? 0.11));
  return Math.round((pacePctOf(p) / 100) * kg * 7700 / 7);
}

// METs from the Compendium of Physical Activities (2011 / 2024 update)
const MET = {
  gym:   { light: 3.5, moderate: 5.0, hard: 6.0 },   // 02054 multiple exercises 8-15 reps; 02052 squats/deadlifts; 02050 vigorous bodybuilding
  swim:  { light: 5.8, moderate: 8.3, hard: 9.8 },   // freestyle slow; crawl medium (~50 yd/min); freestyle fast
  walk:  { light: 3.5, moderate: 4.3, hard: 5.0 },   // 3.0 / 3.5 / 4.0 mph
  run:   { light: 8.3, moderate: 9.8, hard: 11.0 },  // 5 / 6 / 7 mph
  cycle: { light: 4.0, moderate: 6.8, hard: 8.0 },
  sport: { light: 7.0, moderate: 8.0, hard: 10.0 },  // soccer casual / general / competitive
  other: { light: 3.0, moderate: 4.0, hard: 5.0 },
};

export function workoutKcal(w, kg, factor) {
  const type = MET[w.type] ? w.type : 'other';
  const intensity = MET[type][w.intensity] ? w.intensity : 'moderate';
  let minutes = num(w.minutes, 0);
  if (!minutes && type === 'swim' && num(w.distance_km)) minutes = num(w.distance_km) * 22; // ~2:12 / 100m
  if (!minutes && type === 'walk' && num(w.distance_km)) minutes = (num(w.distance_km) / 5.6) * 60;
  if (!minutes) minutes = type === 'swim' ? 50 : 60;
  minutes = clamp(minutes, 5, 180);
  // gym time includes rest between sets, which the Compendium MET already accounts for
  return Math.round((MET[type][intensity] - 1) * kg * (minutes / 60) * factor);
}

export function commuteKcal(p, kg) {
  const hours = (p.commuteKmOneWay * 2) / (p.walkKmh || 5.6);
  const met = (p.walkKmh || 5.6) >= 5.5 ? 4.3 : 3.5;
  return Math.round((met - 1) * kg * hours * p.workoutFactor);
}

// ---------- body estimate ----------
export function bodyEstimate(p, weights, today, avgSessionsPerWeek) {
  const sorted = [...weights].sort((a, b) => a.day.localeCompare(b.day));
  const recent = sorted.slice(-5);
  const weightKg = recent.length ? recent.reduce((s, w) => s + w.kg, 0) / recent.length : p.startWeightKg;
  const ffmRef = p.bodyFatRefWeightKg * (1 - p.bodyFatPct / 100);
  const weeks = Math.max(0, (Date.parse(today) - Date.parse(p.bodyFatRefDay || today)) / 6048e5);
  const consistency = clamp((avgSessionsPerWeek ?? 4) / 4.5, 0, 1);
  const ffm = Math.min(weightKg * 0.95, ffmRef + leanRateOf(p) * weeks * consistency);
  const bf = clamp(((weightKg - ffm) / weightKg) * 100, 5, 45);
  const rmr = 500 + 22 * ffm; // Cunningham
  return { weightKg: round(weightKg, 1), lbm: round(ffm, 1), bodyFatPct: round(bf, 1), bmr: Math.round(rmr) };
}

// ---------- per-day aggregation ----------
export function summarizeDay(day, entries, p, kg) {
  const food = entries.filter((e) => e.kind === 'food');
  const workouts = entries.filter((e) => e.kind === 'workout');
  const plan = entries.filter((e) => e.kind === 'plan').at(-1);
  const sum = (k) => Math.round(food.reduce((s, e) => s + num(e.data[k]), 0));
  const exerciseKcal = workouts.reduce((s, e) => s + num(e.data.kcal) + num(e.data.commute_kcal), 0);
  let plannedKcal = null;
  if (plan) {
    const acts = plan.data.activities || [];
    plannedKcal = acts.reduce((s, a) => s + workoutKcal(a, kg, p.workoutFactor), 0) +
      (acts.some((a) => ['gym', 'swim'].includes(a.type)) && plan.data.commute !== false ? commuteKcal(p, kg) : 0);
  }
  return {
    day,
    weekday: weekday(day),
    kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'), sugar: sum('sugar'),
    sweetKcal: Math.round(food.filter((e) => e.data.sweet).reduce((s, e) => s + num(e.data.kcal), 0)),
    foodCount: food.length,
    exerciseKcal: Math.round(exerciseKcal),
    sessions: workouts.filter((w) => w.data.type !== 'walk').map((w) => w.data.type),
    plannedKcal,
    planned: plan?.data.activities || null,
  };
}

function macros(kcal, kg, ffm, p) {
  const protein = Math.round(proteinFFMOf(p) * ffm);
  const fat = Math.round(((p.goal.mode === 'recomp' ? 0.3 : 0.25) * kcal) / 9); // moderate fat on recomp
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { protein, fat, carbs };
}

// Build everything the app needs from raw data.
export function computeState({ profile: p, entries, weights, today }) {
  const byDay = new Map();
  for (const e of entries) { if (!byDay.has(e.day)) byDay.set(e.day, []); byDay.get(e.day).push(e); }
  const daySum = (d, kg) => summarizeDay(d, byDay.get(d) || [], p, kg);

  // training consistency over the last 14 days
  const rough = bodyEstimate(p, weights, today, 4);
  const days14 = [...Array(14)].map((_, i) => daySum(addDays(today, -i - 1), rough.weightKg));
  const sessions14 = days14.reduce((s, d) => s + d.sessions.length, 0);
  const hasHistory = days14.some((d) => d.foodCount || d.sessions.length);
  const avgSessions = hasHistory ? (sessions14 / 14) * 7 : 5;
  const est = bodyEstimate(p, weights, today, avgSessions);
  const kg = est.weightKg;

  // typical daily exercise burn (history, else from the stated routine)
  const routineWeek = 3.5 * workoutKcal({ type: 'gym', minutes: 60, intensity: 'moderate' }, kg, p.workoutFactor) +
    2 * workoutKcal({ type: 'swim', distance_km: 2.5, intensity: 'moderate' }, kg, p.workoutFactor) +
    5.5 * commuteKcal(p, kg);
  const typicalExercise = hasHistory && sessions14 >= 3
    ? Math.round(days14.reduce((s, d) => s + d.exerciseKcal, 0) / 14)
    : Math.round(routineWeek / 7);

  // Before a workout is logged, assume only 75% of the typical burn (conservative). The real
  // number replaces it once logged, and missed sessions are paid back from the next day.
  const assumedExercise = Math.round(typicalExercise * 0.75);

  // ----- formula maintenance, then self-calibration from real data -----
  const formulaNonEx = est.bmr * p.nonExercisePAL;
  const calib = calibrate(byDay, weights, today, p, kg, formulaNonEx);
  const nonExercise = formulaNonEx + (calib?.adjust || 0);
  const maintenance = Math.round(nonExercise + typicalExercise);
  const offset = energyOffset(p, kg, maintenance);
  const eaFloor = (exercise) => Math.round(30 * est.lbm + exercise); // IOC REDs guidance

  const baseTarget = (exercise) => Math.max(eaFloor(exercise), Math.round(nonExercise + exercise + offset));

  const dayView = (d) => {
    const s = daySum(d, kg);
    const target = baseTarget(s.exerciseKcal);
    return { ...s, target, targetFat: macros(target, kg, est.lbm, p).fat };
  };

  // last 3 days balance -> rebalance today
  const past3 = [1, 2, 3].map((i) => dayView(addDays(today, -i))).filter((d) => d.foodCount > 0);
  const balance = past3.reduce((s, d) => s + (d.kcal - d.target), 0);
  const adj = past3.length ? Math.round(clamp(-balance / 3, -300, 200)) : 0;
  const y = dayView(addDays(today, -1));
  const adjReason = !adj ? null
    : adj < 0 && y.foodCount > 0 && y.sessions.length === 0 && y.kcal > y.target ? 'no training logged yesterday'
    : adj < 0 ? 'over target recently' : 'under target recently';

  // ----- weekly budgets (Mon–Sun) for sugar and fat: high days are balanced by the rest of the week -----
  const ws = weekStart(today);
  const daysLeft = 7 - Math.round((Date.parse(today) - Date.parse(ws)) / 864e5); // incl. today
  const weekPast = []; for (let d = ws; d < today; d = addDays(d, 1)) weekPast.push(dayView(d));
  const loggedPast = weekPast.filter((d) => d.foodCount > 0); // unlogged days don't create leeway
  const sugarCap = sugarLimitOf(p);
  const sugarSpare = loggedPast.reduce((s, d) => s + sugarCap - d.sugar, 0);
  const sugarAllowance = Math.round(clamp(sugarCap + sugarSpare / daysLeft, 0, sugarCap * 1.5));
  const fatSpare = loggedPast.reduce((s, d) => s + d.targetFat - d.fat, 0);
  const fatShift = fatSpare / daysLeft; // g/day to add (+) or take off (−) for the rest of the week
  const week = { daysLeft, loggedDays: loggedPast.length, sugarCap, sugarAllowance, sugarSpare: Math.round(sugarSpare), fatSpare: Math.round(fatSpare) };

  const withBasis = (d, adjustment, weekly = false) => {
    const s = daySum(d, kg);
    let basis, exercise;
    if (s.exerciseKcal > 0) { basis = 'logged'; exercise = Math.max(s.exerciseKcal, s.plannedKcal ?? 0); }
    else if (s.plannedKcal !== null) { basis = 'planned'; exercise = s.plannedKcal; }
    else { basis = 'typical'; exercise = assumedExercise; }
    const raw = Math.round(nonExercise + exercise + offset + adjustment);
    const floor = eaFloor(exercise);
    const target = Math.max(floor, raw);
    const m = macros(target, kg, est.lbm, p);
    let sugarLimit = sugarCap;
    if (weekly) {
      // fat moves within ±20% of normal and never under 20% of calories (ACSM); carbs absorb the difference
      const fat = Math.round(clamp(m.fat + fatShift, Math.max(m.fat * 0.8, (0.2 * target) / 9), m.fat * 1.2));
      m.carbs = Math.max(0, Math.round((target - m.protein * 4 - fat * 9) / 4));
      m.fat = fat;
      sugarLimit = sugarAllowance;
    }
    return {
      ...s, target, targetProtein: m.protein, targetCarbs: m.carbs, targetFat: m.fat, sugarLimit,
      exerciseBasis: basis, exerciseUsed: exercise, adjustment, floored: raw < floor,
      remaining: { kcal: target - s.kcal, protein: m.protein - s.protein, carbs: m.carbs - s.carbs, fat: m.fat - s.fat, sugar: sugarLimit - s.sugar },
    };
  };
  const todayState = { ...withBasis(today, adj, true), adjReason };
  const tomorrowState = withBasis(addDays(today, 1), Math.round(adj / 2), daysLeft > 1);
  // next 3 days, assuming today lands on target (payback halves, then fades)
  const upcoming = [1, 2, 3].map((i) => withBasis(addDays(today, i), i === 1 ? Math.round(adj / 2) : 0, i < daysLeft));
  // what logging a normal gym session (+ the walk) would add on top of today's assumption
  const sessionKcal = workoutKcal({ type: 'gym', minutes: 60, intensity: 'moderate' }, kg, p.workoutFactor) + commuteKcal(p, kg);

  // treats this week
  let sweetsWeek = 0;
  for (let d = weekStart(today); d <= today; d = addDays(d, 1)) sweetsWeek += daySum(d, kg).sweetKcal;

  // the deficit actually achievable on an average day once the EA floor is applied
  const avgTarget = baseTarget(typicalExercise);
  const effectiveOffset = avgTarget - maintenance;

  return {
    today, est, profile: p, week,
    todayState, tomorrowState, upcoming, sessionKcal: Math.round(sessionKcal),
    nonExercise: Math.round(nonExercise), assumedExercise,
    past3: past3.map(({ day, weekday, kcal, protein, target, exerciseKcal, sessions }) => ({ day, weekday, kcal, protein, target, exerciseKcal, sessions })),
    balance3: Math.round(balance),
    treats: { budget: p.weeklyTreatKcal, used: sweetsWeek, left: Math.max(0, p.weeklyTreatKcal - sweetsWeek) },
    typicalExercise, maintenance, offset, effectiveOffset, avgTarget,
    proteinPerKgFFM: proteinFFMOf(p),
    calibration: calib, avgSessions: round(avgSessions, 1),
    dayView,
  };
}

// Back-calculate true maintenance from logged intake and the weight trend.
function calibrate(byDay, weights, today, p, kg, formulaNonEx) {
  const from = addDays(today, -28);
  const days = [];
  for (let d = from; d < today; d = addDays(d, 1)) {
    const s = summarizeDay(d, byDay.get(d) || [], p, kg);
    if (s.foodCount >= 2) days.push(s);
  }
  const slope = weightTrend(weights, today, 28); // kg/week
  if (days.length < 14 || slope === null) return null;
  const avgIn = days.reduce((s, d) => s + d.kcal, 0) / days.length;
  const avgEx = days.reduce((s, d) => s + d.exerciseKcal, 0) / days.length;
  const observedTDEE = avgIn - (slope / 7) * 7700;
  const observedNonEx = observedTDEE - avgEx;
  const confidence = clamp((days.length - 10) / 18, 0.2, 0.75);
  const adjust = Math.round(clamp((observedNonEx - formulaNonEx) * confidence, -400, 400));
  return { observedTDEE: Math.round(observedTDEE), adjust, loggedDays: days.length, confidence: round(confidence, 2) };
}

// ---------- projection ----------
export function project(state, weeks = 40) {
  const { profile: p, est, today, effectiveOffset } = state;
  const lean = leanRateOf(p);
  let fm = est.weightKg - est.lbm, ffm = est.lbm;
  // weekly fat change: deficit all from fat (minus energy that built lean tissue); surplus split with lean gain
  const weeklyEnergy = effectiveOffset * 7;
  const pts = [{ week: 0, day: today, weightKg: est.weightKg, bodyFatPct: est.bodyFatPct }];
  let etaWeek = null;
  const g = p.goal;
  for (let w = 1; w <= weeks; w++) {
    // ~5,000 kcal per kg of new lean tissue (stored energy + synthesis cost); outside a bulk it comes out of fat
    const fatChange = p.goal.mode === 'bulk' ? Math.max(0, weeklyEnergy - lean * 5000) / 7700 * 0.9 : (weeklyEnergy - lean * 5000) / 7700;
    fm = Math.max(3, fm + fatChange);
    ffm += lean;
    const weight = fm + ffm, bf = (fm / weight) * 100;
    pts.push({ week: w, day: addDays(today, w * 7), weightKg: round(weight, 1), bodyFatPct: round(bf, 1) });
    if (etaWeek === null) {
      if (g.mode !== 'bulk' && bf <= g.targetBodyFatPct) etaWeek = w;
      if (g.mode === 'bulk' && g.targetWeightKg && weight >= g.targetWeightKg) etaWeek = w;
    }
    if (etaWeek !== null && w >= etaWeek + 2) break;
  }
  const wk1 = pts[1] || pts[0];
  return {
    points: pts,
    etaWeek,
    etaDay: etaWeek ? addDays(today, etaWeek * 7) : null,
    weeklyWeightKg: round(wk1.weightKg - est.weightKg, 2),
    weeklyPctBW: round(((wk1.weightKg - est.weightKg) / est.weightKg) * 100, 2),
    weeklyLeanKg: lean,
    end: etaWeek ? pts[etaWeek] : pts.at(-1),
  };
}

export function weightTrend(weights, today, windowDays = 21) {
  const from = addDays(today, -windowDays);
  const pts = weights.filter((w) => w.day >= from).map((w) => ({ x: (Date.parse(w.day) - Date.parse(from)) / 864e5, y: w.kg }));
  if (pts.length < 3) return null;
  const span = Math.max(...pts.map((q) => q.x)) - Math.min(...pts.map((q) => q.x));
  if (span < 9) return null;
  const n = pts.length, sx = pts.reduce((s, q) => s + q.x, 0), sy = pts.reduce((s, q) => s + q.y, 0);
  const sxx = pts.reduce((s, q) => s + q.x * q.x, 0), sxy = pts.reduce((s, q) => s + q.x * q.y, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return round(slope * 7, 2); // kg per week
}

// ---------- suggestions ----------
export function suggestions(state, weights) {
  const { today, est, profile: p, dayView, treats } = state;
  const week = [...Array(7)].map((_, i) => dayView(addDays(today, -i - 1)));
  const logged = week.filter((d) => d.foodCount > 0);
  const out = [];
  const push = (level, title, body) => out.push({ level, title, body });
  const pT = Math.round(proteinFFMOf(p) * est.lbm);

  if (p.goal.switchedOn && p.goal.mode === 'bulk' && p.goal.switchedOn >= addDays(today, -7)) {
    push('good', 'Abs reached. Lean bulk on.', `Recomp done at ~${p.goal.targetBodyFatPct}% BF. Now a small surplus to add size. Keep protein high.`);
  }
  if (logged.length < 4) {
    push('info', 'Log every meal', `${logged.length}/7 days logged. Unlogged days are where cuts die.`);
  } else {
    const avg = (k) => logged.reduce((s, d) => s + d[k], 0) / logged.length;
    const avgK = avg('kcal'), avgT = avg('target'), avgP = avg('protein'), avgC = avg('carbs');
    if (avgP < pT * 0.85) push('warn', 'Protein too low', `${Math.round(avgP)} of ${pT} g/day. Add a whey shake or Greek yogurt daily (+25 g).`);
    if (avgK > avgT + 150 && p.goal.mode !== 'bulk') push('warn', "You're overeating", `+${Math.round(avgK - avgT)} kcal/day over target. Measure oil, drop drinks with calories.`);
    if (avgK < avgT - 350) push('warn', 'Undereating', `${Math.round(avgT - avgK)} kcal/day under. You'll lose muscle. Add a carb snack around training.`);
    if (avgC / est.weightKg < 3 && p.goal.mode !== 'bulk') push('info', 'Carbs too low', `${(avgC / est.weightKg).toFixed(1)} g/kg. Aim for 3–5. Rice or oats before swims and legs.`);
    if (p.goal.mode === 'bulk' && avgK < avgT - 150) push('warn', 'Eat more', `${Math.round(avgT - avgK)} kcal/day under your bulk target.`);
  }

  const sessions = week.flatMap((d) => d.sessions);
  const gym = sessions.filter((s) => s === 'gym').length, swim = sessions.filter((s) => s === 'swim').length;
  if (logged.length >= 3 || sessions.length) {
    if (gym < 3) push('warn', "You're skipping the gym", `${gym}/4 lifts this week. Cut without lifting = smaller version of mid.`);
    if (swim < 2) push('info', 'Missed swims', `${swim}/2 swims. Your targets assume both.`);
  }

  const lastW = [...weights].sort((a, b) => b.day.localeCompare(a.day))[0];
  if (!lastW || lastW.day < addDays(today, -7)) push('info', 'Weigh in', 'None in 7 days. Morning, 2–3×/week.');

  const trend = weightTrend(weights, today);
  if (trend !== null) {
    const pct = (trend / est.weightKg) * 100;
    if (p.goal.mode === 'cut' && pct < -1.0) push('warn', 'Losing too fast', `${trend} kg/wk. Eat +150 kcal/day to keep muscle.`);
    if (p.goal.mode === 'cut' && pct > -0.2) push('warn', 'Weight stalled', `${trend > 0 ? '+' : ''}${trend} kg/wk. Log oils, sauces and drinks honestly.`);
    if (p.goal.mode === 'bulk' && pct > 0.5) push('warn', 'Gaining too fast', `+${trend} kg/wk. Cut 150 kcal/day.`);
  }

  if (state.todayState.floored) push('info', 'Deficit capped', `Raised to ${state.todayState.target} kcal to stay above the safety floor.`);
  const sugarCap = sugarLimitOf(p);
  const sugarOver = week.filter((d) => d.foodCount > 0 && d.sugar > sugarCap);
  if (sugarOver.length >= 2) push('warn', 'Too much sugar', `${sugarOver.length}/7 days over ${sugarCap} g. Drinks and sweets go first.`);
  else if (state.todayState.sugar > state.todayState.sugarLimit) push('warn', 'Sugar maxed today', `${state.todayState.sugar}/${state.todayState.sugarLimit} g. No more sweet stuff today.`);
  if (treats.used > treats.budget * 1.25) push('info', 'Treat budget blown', `${treats.used}/${treats.budget} kcal. No more sweets till Monday.`);

  if (p.goal.mode === 'cut' && est.bodyFatPct <= p.goal.targetBodyFatPct + 0.3) push('good', 'Cut done', `~${est.bodyFatPct}% BF. Switch to lean bulk to build the frame.`);

  return out;
}

// ---------- daily report (max 5 lines, blunt) ----------
export function dailyReport(state, weights) {
  const { today, profile: p, dayView, est } = state;
  const y = dayView(addDays(today, -1));
  const pT = Math.round(proteinFFMOf(p) * est.lbm);
  const lines = [];
  if (y.foodCount === 0) {
    lines.push('Yesterday: nothing logged.');
  } else {
    const diff = y.kcal - y.target;
    const verdict = Math.abs(diff) <= 150 ? 'on target' : diff > 0 ? `+${diff}` : `${diff}${diff < -400 ? ', too low' : ''}`;
    const fT = macros(y.target, est.weightKg, est.lbm, p).fat;
    lines.push(`Calories: ${y.kcal}/${y.target} (${verdict}) · Fat: ${y.fat}/${fT} g${y.fat > fT * 1.1 ? ' ✗' : ''}`);
    const sc = sugarLimitOf(p);
    lines.push(`Protein: ${y.protein}/${pT} g${y.protein >= pT * 0.9 ? ' ✓' : ` (−${pT - y.protein} g)`} · Sugar: ${y.sugar}/${sc} g${y.sugar > sc ? ' ✗' : ' ✓'}`);
  }
  let sessions = 0, gym = 0;
  for (let d = weekStart(today); d < today; d = addDays(d, 1)) { const s = dayView(d).sessions; sessions += s.length; gym += s.filter((x) => x === 'gym').length; }
  const elapsed = Math.max(1, (Date.parse(today) - Date.parse(weekStart(today))) / 864e5);
  const expected = Math.round((5.5 * elapsed) / 7);
  lines.push(`Training: ${sessions} this week (${gym} gym)${elapsed >= 2 && sessions < expected - 1 ? ', behind' : ''}`);
  const trend = weightTrend(weights, today);
  if (trend !== null) {
    const want = (pacePctOf(p) / 100) * est.weightKg;
    const ok = p.goal.mode === 'bulk' ? trend > 0 && trend <= want * 1.5
      : p.goal.mode === 'recomp' ? Math.abs(trend) <= 0.25 // maintenance: weight roughly flat
      : trend <= want * 0.5 && trend >= want * 1.6;
    lines.push(`Weight: ${trend > 0 ? '+' : ''}${trend} kg/wk (plan ${want.toFixed(2)})${ok ? ' ✓' : ', off pace'}`);
  } else {
    lines.push('Weight: need more weigh-ins');
  }
  const t = state.todayState;
  lines.push(`Today: ${t.target} kcal · ${t.targetProtein} g protein${t.adjustment ? ` (${t.adjustment > 0 ? '+' : ''}${t.adjustment}: ${t.adjReason})` : ''}`);
  return lines.slice(0, 5);
}

// Weekly brief: how last week went, and how strict the rest of this week has to be.
export function weeklyBrief(state, weights) {
  const { today, profile: p, dayView, est, week, todayState: t } = state;
  const ws = weekStart(today), lastWs = addDays(ws, -7);
  const pT = Math.round(proteinFFMOf(p) * est.lbm);
  const last = [...Array(7)].map((_, i) => dayView(addDays(lastWs, i)));
  const logged = last.filter((d) => d.foodCount > 0);
  const lines = [];
  if (!logged.length) {
    lines.push('Last week: nothing logged.');
  } else {
    const avg = (k) => Math.round(logged.reduce((s, d) => s + d[k], 0) / logged.length);
    const pHit = logged.filter((d) => d.protein >= pT * 0.9).length;
    lines.push(`Last week: ${avg('kcal')}/${avg('target')} kcal avg · protein hit ${pHit}/${logged.length} days`);
    const sug = logged.reduce((s, d) => s + d.sugar, 0), sugCap = week.sugarCap * logged.length;
    const fat = logged.reduce((s, d) => s + d.fat, 0), fatT = logged.reduce((s, d) => s + d.targetFat, 0);
    const sessions = last.reduce((s, d) => s + d.sessions.length, 0);
    lines.push(`Sugar ${sug}/${sugCap} g${sug > sugCap ? ' ✗' : ' ✓'} · Fat ${fat}/${fatT} g${fat > fatT * 1.1 ? ' ✗' : ' ✓'} · ${sessions} session${sessions === 1 ? '' : 's'}`);
    if (logged.length < 5) lines.push(`Only ${logged.length}/7 days logged. Numbers are partial.`);
  }
  const trend = weightTrend(weights, today);
  if (trend !== null) lines.push(`Weight: ${trend > 0 ? '+' : ''}${trend} kg/wk`);
  // the rest of this week
  const s = t.sugarLimit, cap = week.sugarCap, fatBase = macros(t.target, est.weightKg, est.lbm, p).fat;
  const tone = s < cap * 0.85 || t.targetFat < fatBase * 0.95 ? 'tighter' : s > cap * 1.1 || t.targetFat > fatBase * 1.05 ? 'some leeway' : 'normal';
  const left = week.daysLeft === 1 ? 'Today' : `Next ${week.daysLeft} days`;
  lines.push(`${left}: sugar ≤${s} g/day · fat ~${t.targetFat} g/day (${tone})`);
  return lines.slice(0, 5);
}
