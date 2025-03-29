const { verifyToken } = require('../utils/jwt');
const redisService = require('../config/redis');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: '未提供访问令牌'
      });
    }

    // 验证令牌
    const decoded = await verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        status: 'error',
        message: '无效的访问令牌'
      });
    }

    // 检查缓存
    const cacheKey = `user:${decoded.userId}`;
    const cachedUser = await redisService.get(cacheKey);
    if (cachedUser) {
      req.user = cachedUser;
    } else {
      req.user = { id: decoded.userId, role: decoded.role };
    }

    // 检查会话
    const sessionKey = `session:${decoded.sessionId}`;
    const session = await redisService.get(sessionKey);
    if (!session || !session.is_active) {
      return res.status(401).json({
        status: 'error',
        message: '会话已失效，请重新登录'
      });
    }

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

module.exports = { authMiddleware };