#!/bin/bash

# 构建 Docker 镜像（不需要传递环境变量，运行时注入）
docker build \
  -t raoczh/gpt-image:custom-$(date +%Y%m%d-%H%M%S) \
  -t raoczh/gpt-image:latest \
  .

echo "构建完成！"
echo "提示：API_URL 和 API_KEY 将在容器启动时通过环境变量注入"
