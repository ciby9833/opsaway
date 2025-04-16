// src/middleware/auth.js
const { verifyToken } = require('../utils/jwt');
const redisService = require('../config/redis');
const UserSessionModel = require('../models/user_session.model');

// 添加时区验证函数
const validateTimezone = (timezone) => {
  try {
    // 验证时区格式是否有效
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch (e) {
    return false;
  }
};

// 用户认证中间件
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: '未提供访问令牌'
      });
    }

    const decoded = await verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        status: 'error',
        message: '无效的访问令牌'
      });
    }

    // 设置默认平台并验证
    req.headers['x-platform'] = req.headers['x-platform'] || 'web';
    const platform = req.headers['x-platform'];
    
    if (!UserSessionModel.PLATFORMS.includes(platform)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的平台类型'
      });
    }

    // 验证会话
    const sessionKey = `session:${decoded.sessionId}`;
    const session = await redisService.get(sessionKey);
    
    if (!session || !session.is_active) {
      return res.status(401).json({
        status: 'error',
        message: '会话已失效，请重新登录'
      });
    }

    // 获取用户信息
    const cacheKey = `user:${decoded.userId}`;
    const cachedUser = await redisService.get(cacheKey);
    
    req.user = cachedUser || { 
      id: decoded.userId, 
      role: decoded.role,
      timezone: decoded.timezone
    };
    req.sessionId = decoded.sessionId;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      status: 'error',
      message: '认证失败'
    });
  }
};

// 管理员权限中间件需要先验证用户认证
const adminMiddleware = async (req, res, next) => {
  try {
    // 先验证用户认证
    console.log('Before authMiddleware - req.query:', req.query); // === 添加日志 ===
    await authMiddleware(req, res, async () => {
    console.log('After authMiddleware - req.query:', req.query); // === 添加日志 ===
      // 再验证管理员权限
      if (!['admin', 'superadministrator'].includes(req.user.role)) {
        return res.status(403).json({ 
          status: 'error', 
          message: '需要管理员权限' 
        });
      }
      next();
    });
  } catch (error) {
    next(error);
  }
};

// 超级管理员权限中间件同样需要先验证用户认证
const superAdminMiddleware = async (req, res, next) => {
  try {
    console.log('Before authMiddleware - req.query:', req.query); // === 添加日志 ===
    await authMiddleware(req, res, async () => {
    console.log('After authMiddleware - req.query:', req.query); // === 添加日志 ===
      if (req.user.role !== 'superadministrator') {
        return res.status(403).json({ 
          status: 'error', 
          message: '需要超级管理员权限' 
        });
      }
      next();
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { authMiddleware, adminMiddleware, superAdminMiddleware };