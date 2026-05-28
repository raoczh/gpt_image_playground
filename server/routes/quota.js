import express from 'express';
import { requireAuth } from '../auth.js';
import { getQuotaSummary } from '../quota.js';

const app = express.Router();

app.get('/api/quota', requireAuth, async (req, res) => {
  try {
    const summary = await getQuotaSummary(req.session.userId);
    res.json(summary);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Quota summary error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
