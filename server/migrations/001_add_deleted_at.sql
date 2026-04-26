-- 添加逻辑删除字段
-- 执行命令: mysql -u用户名 -p数据库名 < 001_add_deleted_at.sql

ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL COMMENT '删除时间（逻辑删除）' AFTER finished_at;
ALTER TABLE tasks ADD INDEX idx_deleted_at (deleted_at);
