const db = require('../config/database'); // 引入数据库连接实例
const { v4: uuidv4 } = require('uuid'); // 引入uuid生成器
const redisService = require('../config/redis'); // 引入redis服务

class UserSessionModel {
  // 定义允许的平台类型
  static PLATFORMS = ['web', 'mobile', 'desktop'];
  // 创建会话
  static async create({
    user_id,
    token,
    refresh_token,
    device_info,
    platform,
    ip_address,
    is_active = 1,
    expires_at,
    refresh_token_expires_at
  }) {
    try {
      // 检查平台类型是否有效
      if (!UserSessionModel.PLATFORMS.includes(platform)) {
        throw new Error(`Invalid platform: ${platform}`);
      }

      const id = uuidv4();
      const [result] = await db.execute(
        `INSERT INTO user_sessions 
        (id, user_id, token, refresh_token, device_info, platform, 
         ip_address, is_active, expires_at, refresh_token_expires_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, user_id, token, refresh_token, device_info, platform, 
         ip_address, is_active, expires_at, refresh_token_expires_at]
      );

      return { id, user_id, token, refresh_token, device_info, platform, ip_address, is_active, expires_at, refresh_token_expires_at };
    } catch (error) {
    console.error('Create session error:', error);
    throw error;
   } 
  }

  // 更新会话
  static async update(id, {
    token,
    refresh_token,
    expires_at,
    refresh_token_expires_at
  }) {
    try {
      await db.execute(
        `UPDATE user_sessions 
        SET token = ?, 
            refresh_token = ?, 
            expires_at = ?, 
            refresh_token_expires_at = ?,
            last_active = NOW()
        WHERE id = ?`,
        [token, refresh_token, expires_at, refresh_token_expires_at, id]
      );
    } catch (error) {
      console.error('Update session error:', error);
      throw error;
    }
  }

  // 获取用户的活跃会话
  static async findActiveSessionsByUserId(userId) {
    try {
      console.log(`[Session] Finding active sessions for user: ${userId}`);
      
      // 1. 尝试从Redis获取
      const cacheKey = `user_sessions:${userId}`;
      const cachedSessions = await redisService.get(cacheKey);
      
      if (cachedSessions) {
        console.log(`[Session] Found cached sessions: ${JSON.stringify(cachedSessions)}`);
        return cachedSessions;
      }

      // 2. 从数据库获取
      const [rows] = await db.execute(
        `SELECT * FROM user_sessions 
        WHERE user_id = ? 
        AND is_active = 1 
        AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at DESC`,
        [userId]
      );

      console.log(`[Session] Found ${rows.length} sessions in database`);

      // 3. 处理会话数据
      const sessions = rows.map(session => ({
        id: session.id,
        device_info: JSON.parse(session.device_info),
        platform: session.platform,
        ip_address: session.ip_address,
        created_at: session.created_at,
        last_active : session.last_active ,
        expires_at: session.expires_at
      }));

      // 4. 缓存结果
      if (sessions.length > 0) {
        await redisService.set(cacheKey, sessions, 300); // 缓存5分钟
      }

      return sessions;
    } catch (error) {
      console.error('Find active sessions error:', error);
      throw error;
    }
  }

  // 通过刷新令牌查找会话
  static async findByRefreshToken(refreshToken) {
    try {
      const [rows] = await db.execute(
        `SELECT * FROM user_sessions 
        WHERE refresh_token = ? 
        AND is_active = 1
        AND refresh_token_expires_at > NOW()`,
        [refreshToken]
      );
      return rows[0];
    } catch (error) {
      console.error('Find by refresh token error:', error);
      throw error;
    }
  }

  // 使会话失效
  static async deleteById(id) {
    try {
      await db.execute(
        'UPDATE user_sessions SET is_active = 0 WHERE id = ?',
        [id]
      );
      
      // 删除Redis缓存
      await redisService.del(`session:${id}`);
    } catch (error) {
      console.error('Delete session error:', error);
      throw error;
    }
  }

  // 使指定用户的所有会话失效   2025-03-29 17:00
  static async invalidateUserSessions(userId) {
    try {
      // 获取所有活跃会话的 sessionId
      const [rows] = await db.execute(
        'SELECT id FROM user_sessions WHERE user_id = ? AND is_active = 1',
        [userId]
      );
      // 更新数据库
      await db.execute(
        'UPDATE user_sessions SET is_active = 0 WHERE user_id = ? AND is_active = 1',
        [userId]
      );
      // 删除所有相关 Redis 缓存
      const sessionKeys = rows.map(row => `session:${row.id}`);
      if (sessionKeys.length > 0) {
        await redisService.del([...sessionKeys, `user_sessions:${userId}`]);
      }
    } catch (error) {
      console.error('Failed to invalidate sessions:', error);
      throw error;
    }
  }

  // 获取用户的活跃会话数
  static async getActiveSessionCount(userId) {
    const [rows] = await db.execute(
      'SELECT COUNT(*) as count FROM user_sessions WHERE user_id = ? AND is_active = 1',
      [userId]
    );
    return rows[0].count;
  }
}

module.exports = UserSessionModel;