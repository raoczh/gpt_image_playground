import express from 'express';
import { getSystemConfig } from '../systemConfig.js';

const app = express.Router();

// 公开配置接口：前端横幅 / 维护页 / 登录前展示用，无需认证
app.get('/api/public/site-config', async (_req, res) => {
  try {
    const [maintenance, message, announcement, registrationMode, reviewMessage] = await Promise.all([
      getSystemConfig('maintenance_mode'),
      getSystemConfig('maintenance_message'),
      getSystemConfig('announcement'),
      getSystemConfig('registration_mode'),
      getSystemConfig('review_message'),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      maintenance_mode: maintenance === true,
      maintenance_message: message || '',
      announcement: announcement || null,
      registration_mode: registrationMode || 'open',
      review_message: reviewMessage || '',
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Site config error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
