# Vela — a Matrix of Destiny compatibility app

A self-hosted version with a monthly subscription paywall. Anyone can see the chart and category titles for free; generating an actual reading or using chat requires an active Stripe subscription.

**Chart depth:** 9 main octagram points (Personality, Heart Line, Ancestral, Life Purpose, Talents, Love Line, Comfort Zone, Karmic Tail, Core Essence) plus 4 extra lines shown underneath (Money Line, Mother's Line, Father's Line, Health & Vitality) — 13 numbers total, each with its own AI-generated reading.

**Q&A everywhere:** both the individual chart and the compatibility page have a live chat box, so people can ask follow-up questions grounded in their actual numbers — most calculators online only give a fixed block of text with no way to ask anything further.

## What's in here
- `public/index.html` — the front end (chart, categories, chat, compatibility, paywall).
- `server.js` — the backend. Talks to Anthropic and to Stripe; your API keys never reach the browser.
- `package.json` — dependencies (Express, dotenv, jsonwebtoken, stripe).
- `.env.example` — copy this to `.env` and fill it in.

## How the paywall works
1. Someone clicks "Subscribe" → your server asks Stripe to create a Checkout Session → they pay on Stripe's own page.
2. Stripe sends them back to your app with a `session_id` in the URL.
3. Your server verifies with Stripe that the subscription is actually active, then hands the browser a signed access token (valid 24h).
4. Every reading request must include that token. When it's close to expiring, the app silently asks your server to re-check Stripe and issue a fresh one — so a cancelled subscription stops working within a day, without you building anything extra.
5. A "Manage billing" link lets subscribers cancel or update their card through Stripe's own hosted portal — you don't have to build that screen yourself.

## 1. Set up Stripe
1. Create a free account at **stripe.com**.
2. In the Dashboard, go to **Product catalog → Add product**. Name it (e.g. "Octagram — Monthly"), set it to **Recurring**, pick your price and **Monthly** billing. Save, then copy the **Price ID** (starts with `price_...`).
3. Go to **Developers → API keys** and copy your **Secret key** (starts with `sk_test_...` while testing).
4. Go to **Settings → Billing → Customer portal** and turn it on (this powers the "Manage billing" link).
5. Stripe gives you real test card numbers under **Developers → Test cards** — use `4242 4242 4242 4242`, any future date, any CVC, while you're testing.

## 2. Get an Anthropic API key
Same as before: **console.anthropic.com** → add a payment method → **Settings → API Keys**.

## 3. Configure and run locally
You need [Node.js](https://nodejs.org) 18+.

```bash
cd matrix-destiny-app
cp .env.example .env
```

Fill in `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
APP_URL=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID=price_...
JWT_SECRET=          <- generate with the command below
```

Generate a `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then:
```bash
npm install
npm start
```

Open `http://localhost:3000`, click Subscribe, and pay with the Stripe test card above. You should land back on the app, unlocked.

## 4. Go live
- Switch your Stripe keys from test (`sk_test_...`) to live (`sk_live_...`) once you're ready to accept real payments, and create a live-mode version of your product/price.
- Deploy the same way as before — Render.com or Railway.app are the easiest. Set all the `.env` values as environment variables in the host's dashboard (never commit `.env` to a public repo).
- Update `APP_URL` to your real deployed URL (Stripe needs this to redirect people back correctly).
- Point your domain at the host, if you're using one.

## Good to know
- Access is tied to the browser (via `localStorage`), not an account or email. If someone clears their browser data or switches devices, they'll need to click "Manage billing" — actually, they'd need to re-subscribe, since there's no login yet. If that matters to you, the next upgrade is adding email-based accounts (so "restore access" works from any device) — ask any time.
- For extra reliability in production, Stripe recommends also listening for webhook events (e.g. subscription cancelled) rather than relying only on the 24-hour re-check. This version's re-check-on-refresh approach is simpler to set up and fine to start with, but a webhook handler is a natural next step if you want cancellations to take effect instantly instead of within a day.
