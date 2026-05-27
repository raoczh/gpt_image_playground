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
        role VARCHAR(16) NOT NULL DEFAULT 'user' COMMENT '角色: user / admin',
        status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态: active / disabled / pending',
        last_login_at DATETIME NULL COMMENT '最后登录时间',
        quota_overrides JSON NULL COMMENT '配额覆写 (M7)',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL COMMENT '删除时间（逻辑删除）',
        INDEX idx_github_id (github_id),
        INDEX idx_username (username),
        INDEX idx_role (role),
        INDEX idx_status (status),
        INDEX idx_user_deleted_at (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表'
    `);

    // 检查并添加 users 表的 admin 相关字段（M1 + M7 配额覆写）
    // 每列独立检查，避免之前部分迁移（比如只加了 role）导致剩余字段漏迁
    const dbName = process.env.DB_NAME || 'gpt-image';
    const [existingUserCols] = await connection.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
      [dbName]
    );
    const userColSet = new Set(existingUserCols.map((r) => r.COLUMN_NAME));

    const userColumnsToAdd = [
      ['role', `ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user' COMMENT '角色: user / admin' AFTER access_token`],
      ['status', `ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态: active / disabled / pending' AFTER role`],
      ['last_login_at', `ADD COLUMN last_login_at DATETIME NULL COMMENT '最后登录时间' AFTER status`],
      ['quota_overrides', `ADD COLUMN quota_overrides JSON NULL COMMENT '配额覆写 (M7)' AFTER last_login_at`],
      ['deleted_at', `ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL COMMENT '删除时间（逻辑删除）' AFTER updated_at`],
    ];
    const missingCols = userColumnsToAdd.filter(([name]) => !userColSet.has(name));
    if (missingCols.length > 0) {
      console.log(`  📝 Adding missing admin columns to users table: ${missingCols.map(([n]) => n).join(', ')}`);
      await connection.query(`ALTER TABLE users ${missingCols.map(([, ddl]) => ddl).join(', ')}`);
      for (const [name] of missingCols) userColSet.add(name);
    }

    // 索引同样独立检查
    const [existingUserIdx] = await connection.query(
      `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
      [dbName]
    );
    const userIdxSet = new Set(existingUserIdx.map((r) => r.INDEX_NAME));
    const userIndexesToAdd = [
      ['idx_role', 'role'],
      ['idx_status', 'status'],
      ['idx_user_deleted_at', 'deleted_at'],
    ];
    for (const [idxName, col] of userIndexesToAdd) {
      if (userIdxSet.has(idxName) || !userColSet.has(col)) continue;
      try {
        await connection.query(`ALTER TABLE users ADD INDEX ${idxName} (${col})`);
        console.log(`  ✅ Added index ${idxName} on users(${col})`);
      } catch (err) {
        console.warn(`  ⚠️  Failed to add index ${idxName}: ${err.message}`);
      }
    }

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
        thumb_path VARCHAR(500) NULL COMMENT '缩略图存储路径',
        thumb_url VARCHAR(500) NULL COMMENT '缩略图访问 URL',
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

    // 检查并添加 images 表的 deleted_at 字段
    const [imageColumns] = await connection.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'images' AND COLUMN_NAME = 'deleted_at'
    `, [process.env.DB_NAME || 'gpt-image']);

    if (imageColumns.length === 0) {
      console.log('  📝 Adding deleted_at column to images table...');
      await connection.query(`
        ALTER TABLE images
        ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL COMMENT '删除时间（逻辑删除）' AFTER height,
        ADD INDEX idx_deleted_at (deleted_at)
      `);
      console.log('  ✅ Added deleted_at column to images');
    }

    // 检查并添加 images 表的 thumb_path / thumb_url 字段
    const [thumbColumns] = await connection.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'images' AND COLUMN_NAME = 'thumb_path'
    `, [process.env.DB_NAME || 'gpt-image']);

    if (thumbColumns.length === 0) {
      console.log('  📝 Adding thumb_path / thumb_url columns to images table...');
      await connection.query(`
        ALTER TABLE images
        ADD COLUMN thumb_path VARCHAR(500) NULL COMMENT '缩略图存储路径' AFTER file_url,
        ADD COLUMN thumb_url VARCHAR(500) NULL COMMENT '缩略图访问 URL' AFTER thumb_path
      `);
      console.log('  ✅ Added thumb_path / thumb_url columns to images');
    }

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

    // 检查并添加 tasks 表的 is_favorite 字段（U3-2 收藏）
    const [favoriteColumns] = await connection.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'is_favorite'
    `, [process.env.DB_NAME || 'gpt-image']);

    if (favoriteColumns.length === 0) {
      console.log('  📝 Adding is_favorite column to tasks table...');
      await connection.query(`
        ALTER TABLE tasks
        ADD COLUMN is_favorite TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否收藏' AFTER status,
        ADD INDEX idx_favorite (is_favorite)
      `);
      console.log('  ✅ Added is_favorite column');
    }

    // 检查并添加 tasks 表的参数追踪 / 错误增强字段（A-2 / A-4 / A-5）
    const [paramTrackingColumns] = await connection.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'actual_params'
    `, [process.env.DB_NAME || 'gpt-image']);

    if (paramTrackingColumns.length === 0) {
      console.log('  📝 Adding param tracking columns to tasks table...');
      await connection.query(`
        ALTER TABLE tasks
        ADD COLUMN actual_params JSON NULL COMMENT 'API 实际响应参数（A-4）' AFTER params,
        ADD COLUMN revised_prompt_by_image JSON NULL COMMENT 'API 改写后的提示词，按 image id（A-5）' AFTER actual_params,
        ADD COLUMN raw_response_payload LONGTEXT NULL COMMENT '上游原始响应（A-2）' AFTER error_message,
        ADD COLUMN raw_image_urls JSON NULL COMMENT '上游返回的原始图片 URL 列表（A-2）' AFTER raw_response_payload
      `);
      console.log('  ✅ Added param tracking columns');
    }

    // 检查并添加 tasks 表的 api_profile_* 快照字段（U2-2 API Profiles）
    const [profileSnapshotColumns] = await connection.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'api_profile_id'
    `, [process.env.DB_NAME || 'gpt-image']);

    if (profileSnapshotColumns.length === 0) {
      console.log('  📝 Adding api_profile_* snapshot columns to tasks table...');
      await connection.query(`
        ALTER TABLE tasks
        ADD COLUMN api_profile_id VARCHAR(50) NULL COMMENT '使用的 API Profile ID' AFTER params,
        ADD COLUMN api_provider VARCHAR(50) NULL COMMENT 'Provider 类型快照' AFTER api_profile_id,
        ADD COLUMN api_profile_name VARCHAR(100) NULL COMMENT 'Profile 名称快照' AFTER api_provider,
        ADD COLUMN api_model VARCHAR(200) NULL COMMENT '模型 ID 快照' AFTER api_profile_name
      `);
      console.log('  ✅ Added api_profile_* snapshot columns');
    }

    // 检查并添加 tasks 表的 request_meta / output_image_sizes 字段
    {
      const [existingTaskCols] = await connection.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks'`,
        [dbName]
      );
      const taskColSet = new Set(existingTaskCols.map((r) => r.COLUMN_NAME));
      const newTaskCols = [
        ['request_meta', `ADD COLUMN request_meta JSON NULL COMMENT '请求元数据（endpoint/method/params 快照）' AFTER raw_image_urls`],
        ['output_image_sizes', `ADD COLUMN output_image_sizes JSON NULL COMMENT '输出图片尺寸 [{w,h},...]' AFTER output_image_ids`],
      ];
      const missingTaskCols = newTaskCols.filter(([name]) => !taskColSet.has(name));
      if (missingTaskCols.length > 0) {
        console.log(`  📝 Adding columns to tasks: ${missingTaskCols.map(([n]) => n).join(', ')}`);
        await connection.query(`ALTER TABLE tasks ${missingTaskCols.map(([, ddl]) => ddl).join(', ')}`);
        console.log('  ✅ Added request_meta / output_image_sizes columns');
      }
    }

    // 创建 API Profile 表（U2-2）
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_api_profiles (
        id VARCHAR(50) PRIMARY KEY COMMENT 'Profile ID',
        user_id INT NOT NULL COMMENT '用户 ID',
        name VARCHAR(100) NOT NULL COMMENT 'Profile 名称',
        provider VARCHAR(50) NOT NULL DEFAULT 'openai' COMMENT 'Provider 类型: openai / fal / <custom>',
        base_url VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'API 地址',
        api_key VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'API Key',
        model VARCHAR(200) NOT NULL DEFAULT '' COMMENT '模型 ID',
        timeout INT NOT NULL DEFAULT 600 COMMENT '超时（秒）',
        api_format ENUM('imagen', 'responses') NOT NULL DEFAULT 'responses' COMMENT 'OpenAI 模式',
        extra_settings JSON COMMENT '其他扩展设置',
        is_default TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否默认 profile',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_user_default (user_id, is_default),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户 API 配置 Profile'
    `);

    // 创建自定义 HTTP Provider 表（U2-2）
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_custom_providers (
        id VARCHAR(50) PRIMARY KEY COMMENT 'Custom provider ID',
        user_id INT NOT NULL COMMENT '用户 ID',
        name VARCHAR(100) NOT NULL COMMENT 'Provider 显示名',
        template VARCHAR(50) NULL COMMENT '模板类型',
        submit_config JSON NOT NULL COMMENT '提交配置',
        edit_submit_config JSON NULL COMMENT '编辑模式提交配置',
        poll_config JSON NULL COMMENT '轮询配置',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户自定义 HTTP Provider'
    `);

    // 系统配置表（M4 + M5）
    await connection.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        config_key VARCHAR(64) PRIMARY KEY COMMENT '配置 key',
        config_value JSON NOT NULL COMMENT '配置值',
        updated_by INT NULL COMMENT '最后更新者',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置'
    `);

    // 默认配置（仅当不存在时插入）
    const defaultConfigs = [
      ['registration_mode', JSON.stringify('open')],
      ['daily_generation_limit', JSON.stringify(null)],
      ['user_storage_limit_mb', JSON.stringify(null)],
      ['maintenance_mode', JSON.stringify(false)],
      ['maintenance_message', JSON.stringify('系统维护中，请稍后再试')],
      ['announcement', JSON.stringify(null)],
      ['default_api_profile', JSON.stringify(null)],
      ['review_message', JSON.stringify('您的账号正在等待管理员审核，请耐心等待。')],
    ];
    for (const [k, v] of defaultConfigs) {
      await connection.query(
        'INSERT IGNORE INTO system_config (config_key, config_value) VALUES (?, CAST(? AS JSON))',
        [k, v]
      );
    }

    // 注册白名单表（M5）
    await connection.query(`
      CREATE TABLE IF NOT EXISTS registration_allowlist (
        id INT AUTO_INCREMENT PRIMARY KEY,
        github_username VARCHAR(64) NOT NULL UNIQUE COMMENT 'GitHub 用户名（小写比较）',
        added_by INT NULL COMMENT '添加者',
        note VARCHAR(255) NULL COMMENT '备注',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_username (github_username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='注册白名单'
    `);

    // 审计日志表（M8）
    await connection.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        actor_id INT NOT NULL COMMENT '操作者 user_id',
        action VARCHAR(64) NOT NULL COMMENT '动作',
        target_type VARCHAR(32) NULL COMMENT '目标类型',
        target_id VARCHAR(64) NULL COMMENT '目标 ID',
        before_value JSON NULL COMMENT '变更前',
        after_value JSON NULL COMMENT '变更后',
        ip VARCHAR(64) NULL,
        ua VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_actor (actor_id),
        INDEX idx_target (target_type, target_id),
        INDEX idx_action (action),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员审计日志'
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
