import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '172.18.0.1',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'gpt-image',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'gpt-image',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4'
});

// 初始化数据库表结构
async function initDatabase() {
  const connection = await pool.getConnection();

  try {
    console.log('🔄 Initializing database tables...');

    // 创建用户表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        github_id VARCHAR(50) UNIQUE NOT NULL COMMENT 'GitHub 用户 ID',
        username VARCHAR(100) NOT NULL COMMENT 'GitHub 用户名',
        avatar_url VARCHAR(500) COMMENT 'GitHub 头像 URL',
        email VARCHAR(255) COMMENT '邮箱',
        access_token VARCHAR(255) COMMENT 'GitHub Access Token',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_github_id (github_id),
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表'
    `);

    // 创建任务记录表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id VARCHAR(50) PRIMARY KEY COMMENT '任务 ID',
        user_id INT NOT NULL COMMENT '用户 ID',
        prompt TEXT NOT NULL COMMENT '生成提示词',
        status ENUM('running', 'done', 'error') DEFAULT 'running' COMMENT '任务状态',
        error_message TEXT COMMENT '错误信息',
        params JSON COMMENT '生成参数',
        input_image_ids JSON COMMENT '输入图片 ID 列表',
        output_image_ids JSON COMMENT '输出图片 ID 列表',
        started_at BIGINT NOT NULL COMMENT '开始时间戳',
        finished_at BIGINT COMMENT '完成时间戳',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务记录表'
    `);

    // 检查并添加 deleted_at 字段（自动迁移）
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'deleted_at'
    `, [process.env.DB_NAME || 'gpt-image']);

    if (columns.length === 0) {
      console.log('  📝 Adding deleted_at column to tasks table...');
      await connection.query(`
        ALTER TABLE tasks
        ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL COMMENT '删除时间（逻辑删除）' AFTER finished_at,
        ADD INDEX idx_deleted_at (deleted_at)
      `);
      console.log('  ✅ Added deleted_at column');
    }

    // 创建图片表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS images (
        id VARCHAR(64) PRIMARY KEY COMMENT '图片 ID (SHA-256 hash)',
        user_id INT NOT NULL COMMENT '用户 ID',
        file_path VARCHAR(500) NOT NULL COMMENT '文件存储路径',
        file_url VARCHAR(500) NOT NULL COMMENT '访问 URL',
        file_size INT NOT NULL COMMENT '文件大小 (bytes)',
        mime_type VARCHAR(50) NOT NULL COMMENT 'MIME 类型',
        source ENUM('upload', 'generated') DEFAULT 'upload' COMMENT '来源',
        width INT COMMENT '图片宽度',
        height INT COMMENT '图片高度',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_source (source),
        INDEX idx_created_at (created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图片表'
    `);

    // 创建用户设置表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INT PRIMARY KEY COMMENT '用户 ID',
        api_url VARCHAR(500) COMMENT 'API 地址',
        api_key VARCHAR(500) COMMENT 'API Key',
        settings JSON COMMENT '其他设置',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户设置表'
    `);

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

// 测试数据库连接并初始化表
pool.getConnection()
  .then(async conn => {
    console.log('✅ Database connected successfully');
    conn.release();
    await initDatabase();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  });

export default pool;
