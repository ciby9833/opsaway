const redisService = require('../config/redis');


// 接口限流中间件
const rateLimiter = (limit = 100, window = 3600) => {
  return async (req, res, next) => {
    try {
      const key = `ratelimit:${req.ip}`;  // 构建限流键
      const allowed = await redisService.rateLimit(key, limit, window);  // 检查限流
      
      if (!allowed) {
        return res.status(429).json({  // 返回429状态码表示请求过多
          status: 'error',
          message: '请求过于频繁，请稍后再试'
        });
      }
      
      next();  // 继续下一个中间件
    } catch (error) {
      next(error);  // 传递错误给下一个中间件
    }
  };
};

module.exports = {
  rateLimiter
};