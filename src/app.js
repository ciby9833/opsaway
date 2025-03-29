require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const passport = require('./config/passport');

// 导入配置和中间件
const config = require('./config');
const corsMiddleware = require('./middleware/cors');
const { registerValidation, validateLogin, validateRefreshToken } = require('./middleware/validation');
const { rateLimiter } = require('./middleware/cache');  //
const responseHandler = require('./middleware/response');
const app = express();

// 基础中间件配置
app.use(helmet()); // 安全头
app.use(express.json()); // 解析JSON请求体
app.use(express.urlencoded({ extended: true })); // 解析URL编码请求体

app.use(passport.initialize());
// 如果使用 session（可选）
// app.use(passport.session());

// 使用响应处理中间件
app.use(responseHandler);

// CORS配置
app.use(corsMiddleware);

// 认证和速率限制
app.use(rateLimiter(100, 15 * 60)); // 使用自定义 rateLimiter



// API路由
const authRoutes = require('./routes/auth.routes');

// 注册路由时应用验证中间件
app.use(`${config.apiPrefix}/auth`, authRoutes);

// 静态文件服务
if (config.env === 'production') {
  app.use(express.static(path.join(__dirname, '../public')));
}

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    environment: config.env,
    timestamp: new Date().toISOString()
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
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