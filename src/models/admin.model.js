const db = require('../config/database');

class AdminModel {
  // 获取用户列表（支持分页和搜索）
  static async getUsers(page = 1, limit = 10, search = '') {
    const conn = await db.getConnection();
    try {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      if (isNaN(pageNum) || pageNum < 1) throw new Error('Page must be a positive integer');
      if (isNaN(limitNum) || limitNum < 1) throw new Error('Limit must be a positive integer');

      const offset = (pageNum - 1) * limitNum;
      const searchTerm = search === 'null' ? '' : String(search).trim();
      const searchPattern = `%${searchTerm}%`;

      // 使用内联 LIMIT 和 OFFSET，避免占位符问题
      const query = `
        SELECT 
          id, 
          username, 
          email, 
          full_name, 
          is_active, 
          role, 
          created_at, 
          last_login
        FROM users
        WHERE 1=1
        ${searchTerm ? 'AND (username LIKE ? OR email LIKE ? OR full_name LIKE ?)' : ''}
        ORDER BY created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `;
      const queryParams = searchTerm ? [searchPattern, searchPattern, searchPattern] : [];

      console.log('Executing query:', query);
      console.log('With params:', queryParams);

      const [users] = await conn.execute(query, queryParams);

      const countQuery = `
        SELECT COUNT(*) as total 
        FROM users 
        WHERE 1=1
        ${searchTerm ? 'AND (username LIKE ? OR email LIKE ? OR full_name LIKE ?)' : ''}
      `;
      const countParams = searchTerm ? [searchPattern, searchPattern, searchPattern] : [];

      const [totalRows] = await conn.execute(countQuery, countParams);

      return {
        users,
        total: totalRows[0].total
      };
    } catch (error) {
      console.error('AdminModel.getUsers error:', error);
      throw error;
    } finally {
      conn.release();
    }
  }

  // 更新用户状态
  static async updateUserStatus(userId, isActive) {
    const conn = await db.getConnection();
    try {
      const query = 'UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ?';
      await conn.execute(query, [isActive, userId]);
    } finally {
      conn.release();
    }
  }

  // 获取所有活跃会话
  static async getAllActiveSessions(page = 1, limit = 10, userId = null) {
    const conn = await db.getConnection();
    try {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      if (isNaN(pageNum) || pageNum < 1) throw new Error('Page must be a positive integer');
      if (isNaN(limitNum) || limitNum < 1) throw new Error('Limit must be a positive integer');
  
      const offset = (pageNum - 1) * limitNum;
      const query = `
        SELECT us.*, u.username, u.email, u.id as userId
        FROM user_sessions us
        JOIN users u ON us.user_id = u.id
        WHERE us.is_active = 1
        ${userId ? 'AND us.user_id = ?' : ''}
        ORDER BY us.created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `;
      const queryParams = userId ? [userId] : [];
  
      console.log('Executing query:', query);
      console.log('With params:', queryParams);
  
      const [sessions] = await conn.execute(query, queryParams);
  
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM user_sessions 
        WHERE is_active = 1
        ${userId ? 'AND user_id = ?' : ''}
      `;
      const countParams = userId ? [userId] : [];
  
      const [total] = await conn.execute(countQuery, countParams);
  
      return {
        sessions,
        total: total[0].total
      };
    } catch (error) {
      console.error('AdminModel.getAllActiveSessions error:', error);
      throw error;
    } finally {
      conn.release();
    }
  }

  // 终止指定会话
  static async terminateSession(sessionId) {
    const conn = await db.getConnection();
    try {
      const query = 'UPDATE user_sessions SET is_active = 0 WHERE id = ?';
      await conn.execute(query, [sessionId]);
    } finally {
      conn.release();
    }
  }

  // 终止用户的所有会话
  static async terminateUserSessions(userId) {
    const conn = await db.getConnection();
    try {
      const query = 'UPDATE user_sessions SET is_active = 0 WHERE user_id = ?';
      await conn.execute(query, [userId]);
    } finally {
      conn.release();
    }
  }

  // 删除用户
  static async deleteUser(userId, reason = null) {
    const conn = await db.getConnection();
    try {
      const query = 'UPDATE users SET is_active = 0, deleted_at = NOW(), deleted_reason = ? WHERE id = ?';
      await conn.execute(query, [reason, userId]);
    } finally {
      conn.release();
    }
  }

  // 更新用户角色
  static async updateUserRole(userId, role) {
    const conn = await db.getConnection();
    try {
      const query = 'UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?';
      await conn.execute(query, [role, userId]);
    } finally {
      conn.release();
    }
  }

  // 获取用户统计
  static async getUserStats() {
    const conn = await db.getConnection();
    try {
      const query = `
        SELECT 
          COUNT(*) as total_users,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_users,
          SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admin_count,
          SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as new_users_30d
        FROM users
      `;
      const [stats] = await conn.execute(query);
      return stats[0];
    } finally {
      conn.release();
    }
  }

  // 获取会话统计
  static async getSessionStats() {
    const conn = await db.getConnection();
    try {
      const query = `
        SELECT 
          COUNT(*) as total_sessions,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_sessions,
          COUNT(DISTINCT user_id) as unique_users
        FROM user_sessions
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `;
      const [stats] = await conn.execute(query);
      return stats[0];
    } finally {
      conn.release();
    }
  }
}

module.exports = AdminModel;