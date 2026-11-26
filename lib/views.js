// Shapes data for each page.
import { weeklyBrief } from './plan.js';
import { project, suggestions, weightTrend, dailyReport, SOURCES } from './plan.js';
import { addDays, weekStart } from './util.js';

const entryView = (e) => ({ id: e.id, day: e.day, kind: e.kind, ...e.data });

export function todayPayload(state, entries) {
  const t = state.todayState;
  return {
    day: state.today,
    target: t.target, protein: t.targetProtein, carbs: t.targetCarbs, fat: t.targetFat,
    eaten: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, sugar: t.sugar },
    sugarLimit: t.sugarLimit,
    exerciseKcal: t.exerciseKcal, exerciseBasis: t.exerciseBasis, exerciseUsed: t.exerciseUsed, adjustment: t.adjustment, adjReason: t.adjReason,
    treats: state.treats,
    entries: entries.filter((e) => e.day === state.today && e.kind !== 'plan').map(entryView),
  };
}

export function progressPayload(state, entries, weights) {
  const days = [];
  const first = entries.filter((e) => e.kind !== 'plan').map((e) => e.day).sort()[0] || state.today;
  for (let d = first; d <= state.today; d = addDays(d, 1)) {
    const v = state.dayView(d);
    days.push({ day: d, kcal: v.kcal, protein: v.protein, fat: v.fat, fatTarget: v.targetFat, sugar: v.sugar, target: v.target, exerciseKcal: v.exerciseKcal, sessions: v.sessions, logged: v.foodCount > 0 });
  }
  const weeks = {};
  for (const d of days) {
    const w = weekStart(d.day);
    weeks[w] ??= { week: w, gym: 0, swim: 0, other: 0, exerciseKcal: 0 };
    for (const s of d.sessions) weeks[w][s === 'gym' || s === 'swim' ? s : 'other']++;
    weeks[w].exerciseKcal += d.exerciseKcal;
  }
  const proj = project(state, 30);
  return {
    est: state.est,
    report: dailyReport(state, weights),
    sugarLimit: state.week.sugarCap,
    weekly: weeklyBrief(state, weights),
    today: state.today,
    days,
    weeks: Object.values(weeks),
    weights,
    trendKgPerWeek: weightTrend(weights, state.today),
    projection: proj.points.slice(0, Math.min(proj.etaWeek ?? 8, 8) + 1),
    proteinTarget: state.todayState.targetProtein,
    startWeightKg: state.profile.startWeightKg,
  };
}

export function planPayload(state, weights) {
  const proj = project(state, 52);
  const milestones = [4, 8, 12, 16, 24].filter((w) => proj.points[w]).map((w) => proj.points[w]);
  return {
    profile: state.profile,
    est: state.est,
    suggestions: suggestions(state, weights),
    numbers: {
      maintenance: state.maintenance, offset: state.offset, effectiveOffset: state.effectiveOffset, avgTarget: state.avgTarget,
      typicalExercise: state.typicalExercise, todayTarget: state.todayState.target, protein: state.todayState.targetProtein,
      proteinPerKgFFM: state.proteinPerKgFFM, avgSessions: state.avgSessions, calibration: state.calibration,
    },
    sources: SOURCES,
    projection: { ...proj, points: undefined, milestones },
    trendKgPerWeek: weightTrend(weights, state.today),
  };
}

// Today page: where you are, what you can still do, why today looks like this, what's coming.
export function dayPayload(state, entries, mealPlan) {
  const t = state.todayState, w = state.week, p = state.profile;
  const left = { kcal: t.target - t.kcal, protein: t.targetProtein - t.protein, carbs: t.targetCarbs - t.carbs, fat: t.targetFat - t.fat, sugar: t.sugarLimit - t.sugar };
  const fatBase = Math.round(((p.goal.mode === 'recomp' ? 0.3 : 0.25) * t.target) / 9);
  const nextMeal = mealPlan?.data?.today?.[0] || null;
  return {
    day: state.today, weekday: t.weekday, setupDone: !!p.setupDone,
    now: {
      target: t.target, eaten: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, sugar: t.sugar },
      targets: { protein: t.targetProtein, carbs: t.targetCarbs, fat: t.targetFat, sugar: t.sugarLimit },
      left, burned: t.exerciseKcal, basis: t.exerciseBasis, exerciseUsed: t.exerciseUsed,
      logged: entries.filter((e) => e.day === state.today && e.kind === 'food').length,
    },
    can: {
      unlockKcal: t.exerciseBasis === 'logged' ? 0 : Math.max(0, state.sessionKcal - t.exerciseUsed),
      treatsLeft: state.treats.left,
      nextMeal: nextMeal && { name: nextMeal.name, kcal: nextMeal.kcal, protein: nextMeal.protein, slot: nextMeal.slot },
    },
    why: {
      base: state.nonExercise, training: t.exerciseUsed, basis: t.exerciseBasis, goal: state.offset,
      payback: t.adjustment, reason: t.adjReason, floored: t.floored,
      past: state.past3.map((d) => ({ day: d.day, weekday: d.weekday, kcal: d.kcal, target: d.target, diff: d.kcal - d.target, trained: d.sessions.length > 0 })).reverse(),
      week: { daysLeft: w.daysLeft, sugarCap: w.sugarCap, sugarToday: t.sugarLimit, sugarSpare: w.sugarSpare, fatSpare: w.fatSpare, fatToday: t.targetFat, fatBase },
    },
    log: entries.filter((e) => e.day === state.today && e.kind !== 'plan')
      .map((e) => ({ ...entryView(e), at: e.data.time || null, created_at: e.created_at })),
    next: state.upcoming.map((d) => ({ day: d.day, weekday: d.weekday, target: d.target, protein: d.targetProtein, sugar: d.sugarLimit, basis: d.exerciseBasis, planned: d.planned })),
  };
}
