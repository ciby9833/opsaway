const Redis = require('redis');

class RedisService {
  constructor() {
    this.client = Redis.createClient({
      url: process.env.REDIS_CLUSTER_MODE === 'true' 
        ? `redis://${process.env.REDIS_CLUSTER_NODES}`
        : `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
      password: process.env.REDIS_PASSWORD || undefined,
      database: parseInt(process.env.REDIS_DB) || 0
    });

    this.client.on('error', (err) => console.error('Redis Client Error', err));
    this.client.on('connect', () => console.log('Redis Client Connected'));

    // 连接Redis
    this.client.connect().catch(console.error);
  }

  // 设置缓存
  async set(key, value, expireSeconds = 3600) {
    try {
      await this.client.set(key, JSON.stringify(value), {
        EX: expireSeconds
      });
    } catch (error) {
      console.error('Redis set error:', error);
      throw error;
    }
  }

  // 获取缓存
  async get(key) {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Redis get error:', error);
      throw error;
    }
  }

  // 删除缓存
  async del(key) {
    try {
      await this.client.del(key);
    } catch (error) {
      console.error('Redis delete error:', error);
      throw error;
    }
  }

  // 设置限流
  async rateLimit(key, limit, windowSeconds) {
    try {
      const current = await this.client.incr(key);
      if (current === 1) {
        await this.client.expire(key, windowSeconds);
      }
      return current <= limit;
    } catch (error) {
      console.error('Rate limit error:', error);
      throw error;
    }
  }
}

module.exports = new RedisService();