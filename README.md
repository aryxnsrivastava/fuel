# Fuel

A personal food and training coach that runs as an iPhone home-screen app (a PWA). Everything below is free.

| Page | What it does |
|---|---|
| **Chat** | Tell it what you ate, how you trained, your weight, or what's in your fridge. It logs everything and can change anything in the app. Chat history is deleted after 24 h; recipes are kept. |
| **Recipes** | A meal plan for the rest of today and tomorrow. It rebuilds itself from what you've eaten and how you've trained over the last 3 days. Also holds your saved recipes and your pantry, loves and hates. |
| **Progress** | A 5-line daily report, plus charts for weight, calories, protein and training. |
| **Plan** | Suggestions (none if you're on track), your projected rate and date to reach the goal, and where you update goals. |

**Stack:** static PWA, plus Vercel serverless functions in `/api`, plus Neon Postgres. AI is Groq. Web search is Tavily, and it only runs after you tap **Allow**.
All the nutrition math is in `lib/plan.js` and is deterministic, so the numbers don't change depending on the AI. Every formula is cited in the app under **Plan → Sources**.

## 1. Get the free keys (about 10 min)

1. **Groq**: sign up at https://console.groq.com, go to **API Keys**, and create a key.
2. **Neon** (the database): sign up at https://neon.tech, create a project, and copy the **connection string** (`postgresql://…`). Tables are created automatically on first use.
3. **Tavily** (optional, for web lookups): sign up at https://tavily.com and copy the API key. The free plan is 1,000 credits a month.
4. Choose a **passcode** so nobody else can open your data.

## 2. Deploy to Vercel (free)

From this folder:

```bash
npx vercel login
```

```bash
npx vercel link
```

Add each environment variable. It will prompt you for the value; pick all environments:

```bash
npx vercel env add GROQ_API_KEY
```

```bash
npx vercel env add DATABASE_URL
```

```bash
npx vercel env add APP_PASSCODE
```

```bash
npx vercel env add TAVILY_API_KEY
```

```bash
npx vercel --prod
```

It prints a URL like `https://fuel-xxxx.vercel.app`.

## 3. Put it on your iPhone

1. Open the URL in **Safari**. It has to be Safari; other browsers can't add it to the home screen properly.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open **Fuel** from the home screen. It runs full screen like a normal app. Enter your passcode once.

## Run it locally

```bash
npm install
```

```bash
MOCK_AI=1 npm run dev
```

This opens http://localhost:3000. Without `DATABASE_URL` it uses an embedded local Postgres in `.localdb/`. `MOCK_AI=1` fakes the AI so you can test without a key; to use real AI locally, put your keys in a `.env` file (see `.env.example`).

## How the coach works

- **Food** is estimated by the AI, rounded up about 10% because people under-report oil, sauces and drinks.
- **Workouts** are calculated by the server from Compendium MET values, then cut by 20% on purpose. The walk to the gym (set on the Plan page) is added automatically on gym and swim days.
- **Daily target** = resting burn (Cunningham equation) × 1.35 + today's training − your deficit. On top of that is a 3-day payback for over- or under-eating. It never goes below the energy-availability safety floor.
- **Self-calibration**: after 2+ weeks of logs and weigh-ins, the app estimates your real maintenance from your weight trend.
- **Discipline**: the coach is blunt. It won't approve crash diets, cheat weekends, dropping protein, or raising the treat budget. The server enforces those limits too, so it can't be talked past them.
