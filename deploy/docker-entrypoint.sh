#!/bin/sh
set -e

# 设置默认值
API_URL=${API_URL:-https://api.openai.com}
API_KEY=${API_KEY:-}

echo "Replacing environment variables in JS files..."
echo "API_URL: $API_URL"
echo "API_KEY: ${API_KEY:0:10}..." # 只显示前10个字符

# 替换所有 JS 文件中的占位符
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i \
  -e "s|__API_URL_PLACEHOLDER__|$API_URL|g" \
  -e "s|__API_KEY_PLACEHOLDER__|$API_KEY|g" \
  {} \;

echo "Environment variables replaced successfully!"
