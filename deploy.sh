#!/bin/bash

# 停止当前运行的服务
pm2 stop opsaway-b || true

# 拉取最新代码
git pull origin main

# 安装依赖
npm install --production

# 复制生产环境配置
cp .env.production .env

# 构建应用（如果需要）
# npm run build

# 启动服务
pm2 start src/app.js --name opsaway-b --env production

# 保存 PM2 进程列表
pm2 save 