const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  
  // 数据库配置
  database: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    pool: {
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      min: parseInt(process.env.DB_POOL_MIN) || 0,
      acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
      idle: parseInt(process.env.DB_POOL_IDLE) || 10000
    }
  },

  // Redis配置
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB),
    keyPrefix: process.env.REDIS_KEY_PREFIX,
    ttl: parseInt(process.env.REDIS_TTL),
    clusterMode: process.env.REDIS_CLUSTER_MODE === 'true',
    clusterNodes: process.env.REDIS_CLUSTER_NODES
  },

  // JWT配置
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET, // 添加刷新令牌密钥
    expiration: parseInt(process.env.JWT_EXPIRATION) || 3600, // 默认 1 小时
    refreshExpiration: parseInt(process.env.JWT_REFRESH_EXPIRATION) || 604800 // 默认 7 天
  },

  // 邮件配置
  email: {
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    retryCount: parseInt(process.env.EMAIL_RETRY_COUNT),
    retryDelay: parseInt(process.env.EMAIL_RETRY_DELAY),
    senderName: process.env.EMAIL_SENDER_NAME,
    testMode: process.env.EMAIL_TEST_MODE === 'true',
    redirectAllTo: process.env.EMAIL_REDIRECT_ALL_TO
  },

  // CORS配置
  cors: {
    origin: process.env.CORS_ORIGIN,
    credentials: process.env.CORS_CREDENTIALS === 'true'
  },

  // 管理员配置
  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    role: process.env.ADMIN_ROLE
  },

  // 单点登录配置
  auth: {
    platformSingleSession: true, // 启用平台级别的单点登录
    maxSessionsPerPlatform: {
      web: 1,      // Web平台最多1个会话
      mobile: 1,   // 移动端最多1个会话
      tablet: 1,   // 平板最多1个会话
      desktop: 1   // 桌面端最多1个会话
    },
    defaultMaxSessionsPerPlatform: 1, // 默认每个平台最多会话数
    sessionTimeout: 3600 // 会话超时时间（秒）
  }

};

module.exports = config; 