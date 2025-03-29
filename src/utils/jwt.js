// 生成JWT令牌
const jwt = require('jsonwebtoken');
const config = require('../config');  // 引入配置文件

const generateTokens = async (user, sessionId) => {
    // 检查密钥是否存在
  if (!config.jwt.secret || !config.jwt.refreshSecret) {
    throw new Error('JWT secret keys are not configured properly');
  }
  // 生成访问令牌（1小时有效期）
  const accessToken = jwt.sign(
    { 
      userId: user.id,
      role: user.role,
      sessionId: sessionId  // 添加 sessionId
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiration } // 使用配置的过期时间（秒）
  );

  // 生成刷新令牌（7天有效期）
  const refreshToken = jwt.sign(
    { 
      userId: user.id,
      sessionId: sessionId  // 添加 sessionId
    },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiration } // 使用配置的刷新过期时间（秒）
  );

  // 计算过期时间
  const expiresAt = new Date(Date.now() + config.jwt.expiration * 1000); // 使用配置的过期时间（秒）
  const refreshExpiresAt = new Date(Date.now() + config.jwt.refreshExpiration * 1000); // 使用配置的刷新过期时间（秒）

  return {
    accessToken,
    refreshToken,
    expiresAt,
    refreshExpiresAt
  };
};

// 验证 JWT 令牌
const verifyToken = async (token) => {
    try {
      if (!token) {
        throw new Error('令牌不能为空');
      }
  
      const decoded = await jwt.verify(token, config.jwt.secret);
      return decoded;
    } catch (error) {
      console.error('Token verification failed:', error.message);
      return null; // 返回 null 表示验证失败
    }
  };


module.exports = {
  generateTokens,
  verifyToken
};