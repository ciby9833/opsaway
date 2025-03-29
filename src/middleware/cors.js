const cors = require('cors');
const config = require('../config'); // 改为引用统一的入口文件

// CORS配置
const corsOptions = {
  origin: config.cors.origin,
  credentials: config.cors.credentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400 // 24小时
};

// 创建CORS中间件
const corsMiddleware = cors(corsOptions);

module.exports = corsMiddleware; 