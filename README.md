# Fuel

An AI nutrition and training coach you text like a friend. Tell it what you ate and how you trained, and it logs everything, explains your targets for the day, and adjusts the next few days around what actually happened. It installs on your phone like a native app (a PWA).

**One deployment = one person.** There are no accounts. Fork the repo, deploy your own copy with your own free keys, and it's yours. Your data lives in your own database, and nobody else's copy can see it.

| Page | What it does |
|---|---|
| **Today** | Calories and macros left, what you ate and when, what you can still have today, and *why* today's target is what it is (training, goal, last 3 days). |
| **Chat** | Text it what you ate, how you trained, your weight, or what's in your fridge. It logs it all and can change any setting. Name a restaurant or brand and it offers to look up the real numbers. History is kept for 7 days. |
| **Recipes** | Meals for the rest of today and tomorrow that fit your numbers, built from foods you actually eat and your pantry. Saved recipes live here too. |
| **Progress** | Daily report, weekly brief (how much leeway you have for the rest of the week), and charts for weight, calories, protein, fat, sugar and training. |
| **Plan** | What to tighten up, a projection to your goal, and all your settings. |

## Deploy your own (free, about 15 min)

You need free accounts on GitHub, [Vercel](https://vercel.com), and [Groq](https://console.groq.com). Web lookups use [Tavily](https://tavily.com) and are optional.

### 1. Get your keys

| Variable | Required | Where |
|---|---|---|
| `GROQ_API_KEY` | Yes | [console.groq.com](https://console.groq.com) → **API Keys** → Create. Free tier is plenty for one person. |
| `APP_PASSCODE` | Strongly recommended | Any passcode you choose. Without it, anyone with your URL can see and change your data. |
| `TAVILY_API_KEY` | Optional | [tavily.com](https://tavily.com) → API key. Free plan is 1,000 searches a month. Without it, the app just uses AI estimates. |
| `DATABASE_URL` | Yes | Created for you in step 3. |

### 2. Fork and import

1. Click **Fork** at the top of this page.
2. In Vercel: **Add New → Project**, pick your fork, and before deploying open **Environment Variables** and add `GROQ_API_KEY`, `APP_PASSCODE` and (optionally) `TAVILY_API_KEY`.
3. Click **Deploy**. The first deploy will show "No database connected" until step 3. That's expected.

Or use the button (it forks for you and asks for the keys):

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faryxnsrivastava%2Ffuel&project-name=fuel&env=GROQ_API_KEY,APP_PASSCODE&envDescription=GROQ_API_KEY%20from%20console.groq.com.%20APP_PASSCODE%20is%20any%20passcode%20you%20choose%20to%20lock%20the%20app.&envLink=https%3A%2F%2Fgithub.com%2Faryxnsrivastava%2Ffuel%23deploy-your-own-free-about-15-min)

### 3. Add the database

1. In your Vercel project: **Storage → Create Database → Neon** (free).
2. When it asks for an environment variable prefix, use **`DATABASE`** so it creates `DATABASE_URL`. Connect it to Production.
3. **Deployments → ⋯ → Redeploy** so the app picks it up. Tables are created automatically.

### 4. Set yourself up

Open your URL, enter your passcode, and fill in the short setup (sex, height, weight, a body-fat guess, workouts per week, goal). Then just start texting the chat.

From now on, every push to your fork redeploys automatically.

### 5. Put it on your phone

- **iPhone:** open the URL in **Safari** → **Share** → **Add to Home Screen**.
- **Android:** open it in Chrome → **⋮** → **Install app**.

It opens full screen like a normal app, and the login is remembered for a year.

## Make it yours

- **About you** (Plan page, or tell the chat): city, gym, schedule, foods you eat, where you shop. The coach and meal planner read it.
- **Coach personality:** blunt by design. The tone lives in `lib/coach.js` (`RULES`) if you want it softer.
- **Meal style:** `lib/meals.js` (`PROMPT`).
- **The math:** `lib/plan.js`. Every formula is cited in the app under **Plan → Sources**.

## Run it locally

```bash
npm install
```

```bash
MOCK_AI=1 npm run dev
```

This opens http://localhost:3000 with a local embedded database in `.localdb/` and a fake AI. To use the real AI locally, copy `.env.example` to `.env` and add your keys. `.env` is git-ignored.

## How the coach works

- **Food** is estimated by the AI and nudged about 10% high, because people under-report oil, sauces and drinks. Named restaurants and brands can be checked against real published nutrition (only after you tap **Allow**).
- **Workouts** are calculated by the server from Compendium MET values and deliberately under-counted by 20%. Until you log a workout, the day assumes a light one.
- **Daily target** = resting burn (Cunningham) × 1.35 + training + goal offset, plus a 3-day payback if you've been over or under. It never drops below the energy-availability safety floor.
- **Weekly budgets:** sugar and fat flex across the week. A heavy day tightens the days after it.
- **Self-calibration:** after 2+ weeks of logs and weigh-ins, maintenance is re-estimated from your real weight trend.
- **Guardrails:** the chat can lower your sugar cap and treat budget but never raise them, and it won't approve crash diets. The server enforces this, so it can't be talked past it.

**Stack:** static PWA + Vercel serverless functions (`/api`) + Neon Postgres, Groq for the AI, Tavily for web search. All the nutrition math is deterministic code, not the AI.

*Estimates, not medical advice.*
