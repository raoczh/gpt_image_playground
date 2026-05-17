-- 参数追踪 + 错误增强（A-2 / A-4 / A-5）
-- 注意：db.js 启动时会自动检查并 ALTER，这个文件仅作为人工执行兜底
ALTER TABLE tasks
  ADD COLUMN actual_params JSON NULL COMMENT 'API 实际响应参数（A-4）' AFTER params,
  ADD COLUMN revised_prompt_by_image JSON NULL COMMENT 'API 改写后的提示词，按 image id（A-5）' AFTER actual_params,
  ADD COLUMN raw_response_payload LONGTEXT NULL COMMENT '上游原始响应（A-2）' AFTER error_message,
  ADD COLUMN raw_image_urls JSON NULL COMMENT '上游返回的原始图片 URL 列表（A-2）' AFTER raw_response_payload;
