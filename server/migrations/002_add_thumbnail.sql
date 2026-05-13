-- 添加缩略图字段（P2-2）
-- 执行命令: mysql -u用户名 -p数据库名 < 002_add_thumbnail.sql

ALTER TABLE images ADD COLUMN thumb_path VARCHAR(500) NULL COMMENT '缩略图存储路径' AFTER file_url;
ALTER TABLE images ADD COLUMN thumb_url VARCHAR(500) NULL COMMENT '缩略图访问 URL' AFTER thumb_path;
