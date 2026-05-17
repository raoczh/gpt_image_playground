-- 添加任务收藏字段（U3-2）
-- 执行命令: mysql -u用户名 -p数据库名 < 003_add_favorites.sql

ALTER TABLE tasks ADD COLUMN is_favorite TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否收藏' AFTER status;
ALTER TABLE tasks ADD INDEX idx_favorite (`is_favorite`);
