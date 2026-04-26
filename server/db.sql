-- GPT Image Playground 数据库表结构

-- 用户表
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `github_id` VARCHAR(50) UNIQUE NOT NULL COMMENT 'GitHub 用户 ID',
  `username` VARCHAR(100) NOT NULL COMMENT 'GitHub 用户名',
  `avatar_url` VARCHAR(500) COMMENT 'GitHub 头像 URL',
  `email` VARCHAR(255) COMMENT '邮箱',
  `access_token` VARCHAR(255) COMMENT 'GitHub Access Token (加密存储)',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_github_id` (`github_id`),
  INDEX `idx_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 任务记录表
CREATE TABLE IF NOT EXISTS `tasks` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT '任务 ID',
  `user_id` INT NOT NULL COMMENT '用户 ID',
  `prompt` TEXT NOT NULL COMMENT '生成提示词',
  `status` ENUM('running', 'done', 'error') DEFAULT 'running' COMMENT '任务状态',
  `error_message` TEXT COMMENT '错误信息',
  `params` JSON COMMENT '生成参数 (size, quality, format, etc.)',
  `input_image_ids` JSON COMMENT '输入图片 ID 列表',
  `output_image_ids` JSON COMMENT '输出图片 ID 列表',
  `started_at` BIGINT NOT NULL COMMENT '开始时间戳',
  `finished_at` BIGINT COMMENT '完成时间戳',
  `deleted_at` TIMESTAMP NULL DEFAULT NULL COMMENT '删除时间（逻辑删除）',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_created_at` (`created_at`),
  INDEX `idx_deleted_at` (`deleted_at`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务记录表';

-- 图片表
CREATE TABLE IF NOT EXISTS `images` (
  `id` VARCHAR(64) PRIMARY KEY COMMENT '图片 ID (SHA-256 hash)',
  `user_id` INT NOT NULL COMMENT '用户 ID',
  `file_path` VARCHAR(500) NOT NULL COMMENT '文件存储路径',
  `file_url` VARCHAR(500) NOT NULL COMMENT '访问 URL',
  `file_size` INT NOT NULL COMMENT '文件大小 (bytes)',
  `mime_type` VARCHAR(50) NOT NULL COMMENT 'MIME 类型',
  `source` ENUM('upload', 'generated') DEFAULT 'upload' COMMENT '来源',
  `width` INT COMMENT '图片宽度',
  `height` INT COMMENT '图片高度',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_source` (`source`),
  INDEX `idx_created_at` (`created_at`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图片表';

-- 用户设置表
CREATE TABLE IF NOT EXISTS `user_settings` (
  `user_id` INT PRIMARY KEY COMMENT '用户 ID',
  `api_url` VARCHAR(500) COMMENT 'API 地址',
  `api_key` VARCHAR(500) COMMENT 'API Key (加密存储)',
  `settings` JSON COMMENT '其他设置',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户设置表';
