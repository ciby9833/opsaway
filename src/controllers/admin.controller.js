const AdminModel = require('../models/admin.model');
const redisService = require('../config/redis');
const db = require('../config/database');

class AdminController {
  async getUsers(req, res) {    // 获取用户列表 2025-03-30 10:00
    try {
      const page = req.query.page || 1;
      const limit = req.query.limit || 10;
      const search = req.query.search === 'null' ? '' : (req.query.search || '');
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = await AdminModel.getUsers(pageNum, limitNum, search);
      
      res.json({
        status: 'success',
        data: {
          users: result.users,
          total: result.total,
          page: pageNum,
          limit: limitNum
        }
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({ status: 'error', message: '服务器错误：获取用户列表失败' });
    }
  }

  async updateUserStatus(req, res) {    // 更新用户状态 2025-03-30 10:00
    try {
      const { userId } = req.params;
      const { is_active } = req.body;

      if (!userId || !/^[a-f0-9-]{36}$/.test(userId)) {
        return res.status(400).json({ status: 'error', message: '无效的用户 ID' });
      }
      if (typeof is_active !== 'boolean') {
        return res.status(400).json({ status: 'error', message: 'is_active 必须是布尔值' });
      }

      const [userCheck] = await db.execute('SELECT role FROM users WHERE id = ?', [userId]);
      if (!userCheck.length) {
        return res.status(404).json({ status: 'error', message: '用户不存在' });
      }
      if (userCheck[0].role === 'superadministrator') {
        return res.status(403).json({ status: 'error', message: '不能修改超级管理员状态' });
      }

      await AdminModel.updateUserStatus(userId, is_active);
      
      if (!is_active) {
        await AdminModel.terminateUserSessions(userId);
        await redisService.del(`user:${userId}`);
      }

      res.json({
        status: 'success',
        message: is_active ? '用户已启用' : '用户已禁用'
      });
    } catch (error) {
      console.error('Update user status error:', error);
      res.status(500).json({ status: 'error', message: '服务器错误：更新用户状态失败' });
    }
  }

  async getSessions(req, res) {
    try {
      const { page = 1, limit = 10, userId } = req.query;
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      if (userId && !/^[a-f0-9-]{36}$/.test(userId)) {
        return res.status(400).json({ status: 'error', message: '无效的用户 ID' });
      }

      const result = await AdminModel.getAllActiveSessions(pageNum, limitNum, userId);
      
      res.json({
        status: 'success',
        data: {
          sessions: result.sessions,
          total: result.total,
          page: pageNum,
          limit: limitNum
        }
      });
    } catch (error) {
      console.error('Get sessions error:', error);
      res.status(500).json({ status: 'error', message: '服务器错误：获取会话列表失败' });
    }
  }

  async terminateSession(req, res) {
    try {
      const { sessionId } = req.params;

      if (!sessionId || !/^[a-f0-9-]{36}$/.test(sessionId)) {
        return res.status(400).json({ status: 'error', message: '无效的会话 ID' });
      }

      const [sessionCheck] = await db.execute(
        'SELECT us.id, us.is_active, us.user_id, u.role FROM user_sessions us ' +
        'JOIN users u ON us.user_id = u.id ' +
        'WHERE us.id = ?', 
        [sessionId]
      );

      if (!sessionCheck.length) {
        return res.status(404).json({ status: 'error', message: '会话不存在' });
      }
      if (!sessionCheck[0].is_active) {
        return res.status(400).json({ status: 'error', message: '会话已终止' });
      }
      if (sessionCheck[0].role === 'superadministrator') {
        return res.status(403).json({ status: 'error', message: '不能终止超级管理员的会话' });
      }

      await AdminModel.terminateSession(sessionId);
      await redisService.del(`session:${sessionId}`);

      res.json({
        status: 'success',
        message: '会话已终止'
      });
    } catch (error) {
      console.error('Terminate session error:', error);
      res.status(500).json({ status: 'error', message: '服务器错误：终止会话失败' });
    }
  }

  async terminateUserSessions(req, res) {
    try {
      const { userId } = req.params;

      if (!userId || !/^[a-f0-9-]{36}$/.test(userId)) {
        return res.status(400).json({ status: 'error', message: '无效的用户 ID' });
      }

      const [userCheck] = await db.execute('SELECT role, is_active FROM users WHERE id = ?', [userId]);
      if (!userCheck.length) {
        return res.status(404).json({ status: 'error', message: '用户不存在' });
      }
      if (userCheck[0].role === 'superadministrator') {
        return res.status(403).json({ status: 'error', message: '不能终止超级管理员的会话' });
      }

      const [sessionCheck] = await db.execute(
        'SELECT COUNT(*) as count FROM user_sessions WHERE user_id = ? AND is_active = 1',
        [userId]
      );

      if (sessionCheck[0].count === 0) {
        return res.status(400).json({ status: 'error', message: '用户没有活跃的会话' });
      }

      await AdminModel.terminateUserSessions(userId);
      await redisService.del(`user:${userId}`);
      await redisService.del(`user_sessions:${userId}`);

      res.json({
        status: 'success',
        message: `已终止用户的所有会话（共 ${sessionCheck[0].count} 个）`
      });
    } catch (error) {
      console.error('Terminate user sessions error:', error);
      res.status(500).json({ status: 'error', message: '服务器错误：终止用户会话失败' });
    }
  }

  async deleteUser(req, res) {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      if (!userId || !/^[a-f0-9-]{36}$/.test(userId)) {
        return res.status(400).json({ status: 'error', message: '无效的用户 ID' });
      }
      if (reason && typeof reason !== 'string') {
        return res.status(400).json({ status: 'error', message: '删除原因必须是字符串' });
      }

      const [userCheck] = await db.execute('SELECT role, is_active FROM users WHERE id = ?', [userId]);
      if (!userCheck.length) {
        return res.status(404).json({ status: 'error', message: '用户不存在' });
      }
      if (!userCheck[0].is_active) {
        return res.status(400).json({ status: 'error', message: '用户已被删除' });
      }
      if (userCheck[0].role === 'superadministrator') {
        return res.status(403).json({ status: 'error', message: '不能删除超级管理员账户' });
      }

      await AdminModel.deleteUser(userId, reason);
      await AdminModel.terminateUserSessions(userId);
      await redisService.del(`user:${userId}`);
      
      res.json({
        status: 'success',
        message: '用户已标记为删除'
      });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ status: 'error', message: '服务器错误：删除用户失败' });
    }
  }

  async updateUserRole(req, res) {
    try {
      const { userId } = req.params;
      const { role } = req.body;

      if (!userId || !/^[a-f0-9-]{36}$/.test(userId)) {
        return res.status(400).json({ status: 'error', message: '无效的用户 ID' });
      }
      if (!role || !['user', 'admin', 'superadministrator'].includes(role)) {
        return res.status(400).json({ status: 'error', message: '无效的角色类型' });
      }

      const [userCheck] = await db.execute('SELECT role FROM users WHERE id = ?', [userId]);
      if (!userCheck.length) {
        return res.status(404).json({ status: 'error', message: '用户不存在' });
      }
      if (userCheck[0].role === 'superadministrator') {
        return res.status(403).json({ status: 'error', message: '不能修改超级管理员角色' });
      }

      await AdminModel.updateUserRole(userId, role);
      await redisService.del(`user:${userId}`);
      
      res.json({
        status: 'success',
        message: '用户角色已更新'
      });
    } catch (error) {
      console.error('Update user role error:', error);
      res.status(500).json({ status: 'error', message: '服务器错误：更新用户角色失败' });
    }
  }

  async getUserStats(req, res) {
    try {
      const stats = await AdminModel.getUserStats();
      res.json({ status: 'success', data: stats });
    } catch (error) {
      console.error('Get user stats error:', error);
      res.status(500).json({ status: 'error', message: '获取用户统计失败' });
    }
  }

  async getSessionStats(req, res) {
    try {
      const stats = await AdminModel.getSessionStats();
      res.json({ status: 'success', data: stats });
    } catch (error) {
      console.error('Get session stats error:', error);
      res.status(500).json({ status: 'error', message: '获取会话统计失败' });
    }
  }
}

module.exports = new AdminController();