import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import db from './db.js';
import createAdminRouter from './adminRouter.js';
import { generateProfileId } from './services/apiSettings.js';
import { assertSessionSecret, createRedisClient, createSessionMiddleware } from './config/session.js';
import { createMaintenanceMiddleware } from './middleware/maintenance.js';
import publicRouter from './routes/public.js';
import authRouter from './routes/auth.js';
import quotaRouter from './routes/quota.js';
import userConfigRouter from './routes/userConfig.js';
import tasksRouter from './routes/tasks.js';
import generateRouter from './routes/generate.js';
import imagesRouter from './routes/images.js';
import {
  backfillThumbnails,
  cleanupSoftDeleted,
  cleanupOrphanFiles,
  cleanupStuckTasks,
  CLEANUP_INTERVAL_MS,
  STUCK_TASK_CHECK_INTERVAL_MS,
} from './jobs/cleanup.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 80;
const isProduction = process.env.NODE_ENV === 'production';

assertSessionSecret();

// Redis 客户端
const redisClient = await createRedisClient();

// 信任反向代理（Nginx/Caddy），使 secure cookie 和 req.ip 正常工作
app.set('trust proxy', 1);

// 中间件
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session 配置
const { store: sessionStoreInstance, middleware: sessionMiddleware } = createSessionMiddleware(redisClient);
app.use(sessionMiddleware);

app.use(createMaintenanceMiddleware());
app.use(publicRouter);
app.use(authRouter);
app.use('/api/admin', createAdminRouter(db, { sessionStore: sessionStoreInstance, generateProfileId }));
app.use(quotaRouter);
app.use(userConfigRouter);
app.use(tasksRouter);
app.use(generateRouter);
app.use(imagesRouter);

app.use('/images', express.static(process.env.IMAGE_UPLOAD_DIR || '/data/images'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.use(express.static('public'));

app.get('*', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] 🚀 Server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] 📝 Environment: ${isProduction ? 'production' : 'development'}`);
  console.log(`[${new Date().toISOString()}] 🔗 CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
  console.log(`[${new Date().toISOString()}] 🗄️  Redis: ${redisClient ? 'connected' : 'memory session'}`);
  // 异步触发 backfill，不阻塞 listen；首次启动数据多时也不影响接收请求
  backfillThumbnails().catch((err) => {
    console.error(`[${new Date().toISOString()}] ❌ Backfill thumbnails error:`, err.message);
  });
  // 启动时清理一次过期软删除文件，并每 24h 重复
  cleanupSoftDeleted().catch((err) => {
    console.error(`[${new Date().toISOString()}] ❌ Cleanup soft-deleted error:`, err.message);
  });
  setInterval(() => {
    cleanupSoftDeleted().catch((err) => {
      console.error(`[${new Date().toISOString()}] ❌ Cleanup soft-deleted error:`, err.message);
    });
  }, CLEANUP_INTERVAL_MS);
  // 启动时扫一次磁盘孤儿（DB 完全没记录的文件），只在启动时跑
  cleanupOrphanFiles().catch((err) => {
    console.error(`[${new Date().toISOString()}] ❌ Cleanup orphan files error:`, err.message);
  });
  // 启动时 + 每小时检测 zombie task（running 超时），避免前端断网导致 task 永远停在 running
  cleanupStuckTasks().catch((err) => {
    console.error(`[${new Date().toISOString()}] ❌ Cleanup stuck tasks error:`, err.message);
  });
  setInterval(() => {
    cleanupStuckTasks().catch((err) => {
      console.error(`[${new Date().toISOString()}] ❌ Cleanup stuck tasks error:`, err.message);
    });
  }, STUCK_TASK_CHECK_INTERVAL_MS);
});
