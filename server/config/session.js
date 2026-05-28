import session from 'express-session';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';

const isProduction = process.env.NODE_ENV === 'production';
export const sessionCookieName = process.env.SESSION_COOKIE_NAME || 'connect.sid';
const sessionCookieDomain = process.env.SESSION_COOKIE_DOMAIN || undefined;
export const sessionCookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  domain: sessionCookieDomain,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

export function assertSessionSecret() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required');
  }
}

export function clearSessionCookie(res) {
  res.clearCookie(sessionCookieName, {
    path: sessionCookieOptions.path,
    httpOnly: sessionCookieOptions.httpOnly,
    sameSite: sessionCookieOptions.sameSite,
    secure: sessionCookieOptions.secure,
    domain: sessionCookieOptions.domain,
  });
}

export function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function redirectWithError(res, error) {
  const location = new URL('/login', process.env.APP_ORIGIN || 'http://localhost:5173');
  location.searchParams.set('error', error);
  res.redirect(location.toString());
}

export async function createRedisClient() {
  try {
    const redisClient = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379')
      },
      password: process.env.REDIS_PASSWORD || undefined
    });
    await redisClient.connect();
    console.log('✅ Redis connected');
    return redisClient;
  } catch (err) {
    console.warn('⚠️  Redis connection failed, using memory session:', err.message);
    return null;
  }
}

export function createSessionMiddleware(redisClient) {
  const sessionStoreInstance = redisClient ? new RedisStore({ client: redisClient }) : null;
  const sessionConfig = {
    name: sessionCookieName,
    secret: process.env.SESSION_SECRET,
    resave: false,
    rolling: true,
    saveUninitialized: false,
    cookie: sessionCookieOptions,
  };

  if (sessionStoreInstance) {
    sessionConfig.store = sessionStoreInstance;
  }

  return {
    store: sessionStoreInstance,
    middleware: session(sessionConfig),
  };
}
