require('dotenv').config();
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');

const app = express();
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const TOKEN_LIFETIME = '24h'; // re-checked against Stripe periodically, see /api/refresh-token

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- helpers ---------- */
function issueToken(customerId, subscriptionId) {
  return jwt.sign({ customerId, subscriptionId }, JWT_SECRET, { expiresIn: TOKEN_LIFETIME });
}

function requireSubscription(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'subscription_required' });
  try {
    req.subscriber = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token_expired' });
  }
}

/* ---------- price info (so the front end never hardcodes a dollar amount) ---------- */
app.get('/api/price', async (req, res) => {
  if (!stripe || !process.env.STRIPE_PRICE_ID) {
    return res.status(500).json({ error: 'Stripe is not configured yet.' });
  }
  try {
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
    res.json({
      amount: price.unit_amount,
      currency: price.currency,
      interval: price.recurring ? price.recurring.interval : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load price.' });
  }
});

/* ---------- start a subscription checkout ---------- */
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe || !process.env.STRIPE_PRICE_ID) {
    return res.status(500).json({ error: 'Stripe is not configured yet.' });
  }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${APP_URL}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

/* ---------- verify a completed checkout, issue an access token ---------- */
app.get('/api/verify-session', async (req, res) => {
  const { session_id } = req.query;
  if (!stripe || !session_id) return res.status(400).json({ error: 'Missing session_id.' });
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
    const sub = session.subscription;
    if (!sub || !['active', 'trialing'].includes(sub.status)) {
      return res.status(402).json({ error: 'subscription_inactive' });
    }
    const token = issueToken(session.customer, sub.id);
    res.json({ token, customerId: session.customer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not verify checkout session.' });
  }
});

/* ---------- refresh an access token, re-checking Stripe for real status ---------- */
app.post('/api/refresh-token', async (req, res) => {
  const { token } = req.body || {};
  if (!token || !stripe) return res.status(400).json({ error: 'Missing token.' });
  let payload;
  try {
    payload = jwt.decode(token); // decode without verifying expiry, we're about to re-check anyway
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  if (!payload || !payload.subscriptionId) return res.status(401).json({ error: 'invalid_token' });
  try {
    const sub = await stripe.subscriptions.retrieve(payload.subscriptionId);
    if (!['active', 'trialing'].includes(sub.status)) {
      return res.status(402).json({ error: 'subscription_inactive' });
    }
    const newToken = issueToken(payload.customerId, sub.id);
    res.json({ token: newToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not refresh subscription status.' });
  }
});

/* ---------- let a subscriber manage/cancel billing ---------- */
app.post('/api/create-portal-session', async (req, res) => {
  const { customerId } = req.body || {};
  if (!stripe || !customerId) return res.status(400).json({ error: 'Missing customerId.' });
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: APP_URL,
    });
    res.json({ url: portal.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

/* ---------- the actual reading — gated behind an active subscription ---------- */
app.post('/api/reading', requireSubscription, async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it to your .env file.' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1100,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(502).json({ error: data.error?.message || 'Reading service error.' });
    }
    const text = (data.content || []).map((b) => b.text || '').join('\n').trim();
    res.json({ text });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Something went wrong generating the reading.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Octagram running at http://localhost:${PORT}`);
});
