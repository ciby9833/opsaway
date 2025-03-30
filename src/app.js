require('dotenv').config(); // 导入dotenv 2025-03-29 14:30
const express = require('express'); // 导入express 2025-03-29 14:30
const helmet = require('helmet'); // 安全头 2025-03-29 14:30
const path = require('path'); // 路径 2025-03-29 14:30
const passport = require('./config/passport'); // 认证配置 2025-03-29 14:30

// 导入配置和中间件
const config = require('./config'); // 配置 2025-03-29 14:30
const corsMiddleware = require('./middleware/cors'); // CORS配置 2025-03-29 14:30
const { registerValidation, validateLogin, validateRefreshToken } = require('./middleware/validation'); // 验证中间件 2025-03-29 14:30
const { rateLimiter } = require('./middleware/cache');  // 速率限制 2025-03-29 14:30
const responseHandler = require('./middleware/response'); // 响应处理中间件 2025-03-29 14:30

// 导入路由
const authRoutes = require('./routes/auth.routes'); // 认证路由 2025-03-29 14:30
const superAdminRoutes = require('./routes/super-admin.routes'); // 超级管理员路由 2025-03-29 14:30

const app = express(); // 创建express应用 2025-03-29 14:30

// 基础中间件配置
app.use(helmet()); // 安全头 2025-03-29 14:30
app.use(express.json()); // 解析JSON请求体 2025-03-29 14:30
app.use(express.urlencoded({ extended: true })); // 解析URL编码请求体 2025-03-29 14:30

app.use(passport.initialize()); // 初始化passport 2025-03-29 14:30
// 如果使用 session（可选）
// app.use(passport.session());

// 使用响应处理中间件
app.use(responseHandler); // 响应处理中间件 2025-03-29 14:30

// CORS配置
app.use(corsMiddleware); // CORS配置 2025-03-29 14:30

// 认证和速率限制
app.use(rateLimiter(100, 15 * 60)); // 使用自定义 rateLimiter 2025-03-29 14:30

// 注册路由
// 普通用户认证路由 - /api/v1/auth/*
app.use(`${config.apiPrefix}/auth`, authRoutes); // 认证路由 2025-03-29 14:30

// 超级管理员路由 - /api/v1/system/*
app.use(`${config.apiPrefix}/system`, superAdminRoutes); // 超级管理员路由 2025-03-29 14:30

// 静态文件服务
if (config.env === 'production') {
  app.use(express.static(path.join(__dirname, '../public'))); // 静态文件服务 2025-03-29 14:30
}

// 健康检查
app.get('/health', (req, res) => {  // 健康检查 2025-03-29 14:30
  res.json({ 
    status: 'ok',
    environment: config.env,
    timestamp: new Date().toISOString()
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {  // 错误处理中间件 2025-03-29 14:30
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: config.env === 'development' ? err.message : 'Internal Server Error',
    ...(config.env === 'development' && { stack: err.stack })
  });
});

// 启动服务器
app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
  console.log(`Environment: ${config.env}`);
  console.log(`API Prefix: ${config.apiPrefix}`);
});

module.exports = app; 