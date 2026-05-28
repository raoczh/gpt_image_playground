import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import db from '../db.js';
import { requireSession, invalidateUserCache } from '../auth.js';
import { getSystemConfig } from '../systemConfig.js';
import { clearSessionCookie, destroySession, saveSession, redirectWithError } from '../config/session.js';
import { generateProfileId } from '../services/apiSettings.js';

const app = express.Router();

// 认证中间件 (requireAuth / requireAdmin / requireSession) 由 ../auth.js 提供
// requireAuth 会查 users 表（30s 缓存）拦截 disabled / pending / 软删用户

app.get('/api/auth/github', async (req, res) => {
  console.log(`[${new Date().toISOString()}] 🔐 GitHub OAuth initiated - IP: ${req.ip}`);
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = process.env.GITHUB_CALLBACK_URL;
  const scope = 'user:email';
  const state = crypto.randomBytes(24).toString('hex');

  req.session.oauthState = state;
  await saveSession(req);

  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', clientId);
  githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
  githubAuthUrl.searchParams.set('scope', scope);
  githubAuthUrl.searchParams.set('state', state);
  console.log(`[${new Date().toISOString()}] ↗️  Redirecting to GitHub - State: ${state.substring(0, 8)}...`);
  res.redirect(githubAuthUrl.toString());
});

app.get('/api/auth/github/callback', async (req, res) => {
  const { code, state } = req.query;
  console.log(`[${new Date().toISOString()}] 🔙 GitHub callback - Code: ${code ? 'present' : 'missing'}, State: ${state?.substring(0, 8)}...`);

  if (!code) {
    console.error(`[${new Date().toISOString()}] ❌ OAuth callback failed - No code`);
    return redirectWithError(res, 'no_code');
  }

  if (!state || state !== req.session.oauthState) {
    console.error(`[${new Date().toISOString()}] ❌ OAuth callback failed - Invalid state`);
    return redirectWithError(res, 'invalid_state');
  }

  try {
    console.log(`[${new Date().toISOString()}] 🔄 Exchanging code for token`);
    const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code
    }, {
      headers: { Accept: 'application/json' }
    });

    const accessToken = tokenResponse.data.access_token;
    console.log(`[${new Date().toISOString()}] ✅ Token received, fetching user info`);

    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const githubUser = userResponse.data;
    console.log(`[${new Date().toISOString()}] 👤 GitHub user: ${githubUser.login} (ID: ${githubUser.id})`);

    const [rows] = await db.query(
      'SELECT * FROM users WHERE github_id = ?',
      [githubUser.id.toString()]
    );

    let userId;
    if (rows.length > 0) {
      userId = rows[0].id;
      console.log(`[${new Date().toISOString()}] 🔄 Updating existing user ${userId}`);
      if (rows[0].deleted_at) {
        console.warn(`[${new Date().toISOString()}] 🚫 Login blocked - user soft-deleted: ${userId}`);
        return redirectWithError(res, 'account_deleted');
      }
      if (rows[0].status === 'disabled') {
        console.warn(`[${new Date().toISOString()}] 🚫 Login blocked - user disabled: ${userId}`);
        return redirectWithError(res, 'disabled');
      }
      await db.query(
        'UPDATE users SET username = ?, avatar_url = ?, email = ?, last_login_at = NOW(), updated_at = NOW() WHERE id = ?',
        [githubUser.login, githubUser.avatar_url, githubUser.email, userId]
      );
      invalidateUserCache(userId);
    } else {
      // M5：按 registration_mode 决定新用户创建策略
      const registrationMode = (await getSystemConfig('registration_mode')) || 'open';
      let initialStatus = 'active';

      if (registrationMode === 'allowlist') {
        const username = String(githubUser.login || '').toLowerCase();
        const [allowRows] = await db.query(
          'SELECT id FROM registration_allowlist WHERE github_username = ?',
          [username]
        );
        if (!allowRows.length) {
          console.warn(`[${new Date().toISOString()}] 🚫 Registration blocked - not in allowlist: ${username}`);
          return redirectWithError(res, 'not_allowed');
        }
        initialStatus = 'active';
      } else if (registrationMode === 'review') {
        initialStatus = 'pending';
      }

      console.log(`[${new Date().toISOString()}] ➕ Creating new user (mode=${registrationMode}, status=${initialStatus})`);
      const [result] = await db.query(
        'INSERT INTO users (github_id, username, avatar_url, email, status, last_login_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [githubUser.id.toString(), githubUser.login, githubUser.avatar_url, githubUser.email, initialStatus]
      );
      userId = result.insertId;
      console.log(`[${new Date().toISOString()}] ✅ New user created with ID ${userId}`);

      // M5：注入默认 Profile（如配置）
      try {
        const defaultProfile = await getSystemConfig('default_api_profile');
        if (defaultProfile && typeof defaultProfile === 'object') {
          const profileId = generateProfileId();
          await db.query(
            `INSERT INTO user_api_profiles (id, user_id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings, is_default)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              profileId,
              userId,
              String(defaultProfile.name || '默认').slice(0, 100),
              String(defaultProfile.provider || 'openai'),
              String(defaultProfile.base_url || ''),
              String(defaultProfile.api_key || ''),
              String(defaultProfile.model || ''),
              Math.max(10, Math.min(3600, Number(defaultProfile.timeout) || 600)),
              defaultProfile.api_format === 'imagen' ? 'imagen' : 'responses',
              defaultProfile.extra && typeof defaultProfile.extra === 'object' ? JSON.stringify(defaultProfile.extra) : null,
            ]
          );
          console.log(`[${new Date().toISOString()}] 🎁 Injected default profile for new user ${userId}`);
        }
      } catch (err) {
        console.error(`[${new Date().toISOString()}] ⚠️  Failed to inject default profile: ${err.message}`);
      }
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    req.session.userId = userId;
    req.session.username = githubUser.login;

    await saveSession(req);
    console.log(`[${new Date().toISOString()}] ✅ Login successful - User ${userId} (${githubUser.login})`);
    res.redirect(process.env.APP_ORIGIN || 'http://localhost:5173');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ GitHub OAuth error:`, error.message);
    redirectWithError(res, 'auth_failed');
  }
});

app.get('/api/auth/me', requireSession, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, github_id, username, avatar_url, email, role, status, last_login_at, created_at FROM users WHERE id = ? AND deleted_at IS NULL',
      [req.session.userId]
    );

    if (rows.length === 0) {
      console.error(`[${new Date().toISOString()}] ❌ User not found in DB - User ID: ${req.session.userId}`);
      clearSessionCookie(res);
      await destroySession(req).catch(() => {});
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(rows[0]);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get user error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] 🚪 Logout - User ID: ${req.session?.userId || 'unknown'}`);
    if (req.session) {
      await destroySession(req);
    }
    clearSessionCookie(res);
    res.set('Clear-Site-Data', '"cache", "storage"');
    res.set('Cache-Control', 'no-store');
    console.log(`[${new Date().toISOString()}] ✅ Logout successful`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ Logout failed:`, err.message);
    res.status(500).json({ error: 'Logout failed' });
  }
});

export default app;
