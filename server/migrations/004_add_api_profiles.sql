-- 添加 API Profile 多配置支持（U1-2 + U2-2）
-- 执行命令: mysql -u用户名 -p数据库名 < 004_add_api_profiles.sql

-- API 配置 Profile（一个用户可以保存多个，每个 profile 对应一个上游 provider 实例）
CREATE TABLE IF NOT EXISTS `user_api_profiles` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT 'Profile ID',
  `user_id` INT NOT NULL COMMENT '用户 ID',
  `name` VARCHAR(100) NOT NULL COMMENT 'Profile 名称',
  `provider` VARCHAR(50) NOT NULL DEFAULT 'openai' COMMENT 'Provider 类型: openai / fal / <custom provider id>',
  `base_url` VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'API 地址',
  `api_key` VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'API Key',
  `model` VARCHAR(200) NOT NULL DEFAULT '' COMMENT '模型 ID',
  `timeout` INT NOT NULL DEFAULT 600 COMMENT '超时（秒）',
  `api_format` ENUM('imagen', 'responses') NOT NULL DEFAULT 'responses' COMMENT 'OpenAI 模式：images API 或 Responses API',
  `extra_settings` JSON COMMENT '其他扩展设置（codexCli/apiProxy/responseFormatB64Json 等）',
  `is_default` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否默认 profile',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_user_default` (`user_id`, `is_default`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户 API 配置 Profile';

-- 自定义 HTTP Provider 定义（每个用户可定义任意 HTTP-style provider）
CREATE TABLE IF NOT EXISTS `user_custom_providers` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT 'Custom provider ID',
  `user_id` INT NOT NULL COMMENT '用户 ID',
  `name` VARCHAR(100) NOT NULL COMMENT 'Provider 显示名',
  `template` VARCHAR(50) NULL COMMENT '模板类型，目前固定 http-image',
  `submit_config` JSON NOT NULL COMMENT '提交配置（method/path/body/files/result 等）',
  `edit_submit_config` JSON NULL COMMENT '编辑模式提交配置（与 submit 不同时使用）',
  `poll_config` JSON NULL COMMENT '轮询配置（异步 provider 才需要）',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户自定义 HTTP Provider';

-- 任务表记录使用的 profile 信息（用于显示和审计）
ALTER TABLE tasks ADD COLUMN api_profile_id VARCHAR(50) NULL COMMENT '使用的 API Profile ID' AFTER params;
ALTER TABLE tasks ADD COLUMN api_provider VARCHAR(50) NULL COMMENT 'Provider 类型快照' AFTER api_profile_id;
ALTER TABLE tasks ADD COLUMN api_profile_name VARCHAR(100) NULL COMMENT 'Profile 名称快照' AFTER api_provider;
ALTER TABLE tasks ADD COLUMN api_model VARCHAR(200) NULL COMMENT '模型 ID 快照' AFTER api_profile_name;

-- 从 user_settings 表初始化每个用户的默认 profile
-- 旧字段 api_url/api_key/settings (包含 model/timeout/apiFormat) → 新增一条 is_default=1 的 profile
INSERT INTO user_api_profiles (id, user_id, name, provider, base_url, api_key, model, timeout, api_format, is_default)
SELECT
  CONCAT('default-', user_id) AS id,
  user_id,
  '默认' AS name,
  'openai' AS provider,
  COALESCE(api_url, '') AS base_url,
  COALESCE(api_key, '') AS api_key,
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(settings, '$.model')), 'gpt-image-1') AS model,
  COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(settings, '$.timeout')) AS UNSIGNED), 600) AS timeout,
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(settings, '$.apiFormat')), 'responses') AS api_format,
  1 AS is_default
FROM user_settings
WHERE NOT EXISTS (
  SELECT 1 FROM user_api_profiles WHERE user_api_profiles.user_id = user_settings.user_id
);
