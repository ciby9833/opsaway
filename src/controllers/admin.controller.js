const AdminModel = require('../models/admin.model');
const redisService = require('../config/redis');
const db = require('../config/database');
const UserSessionModel = require('../models/user_session.model');
const emailTemplates = require('../templates');
const { sendEmail } = require('../config/email');

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
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      
      const { userId } = req.params;
      const deleted_reason = req.body.reason || null;

      if (!userId || !/^[a-f0-9-]{36}$/.test(userId)) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          code: 400,
          message: '无效的用户 ID',
          data: null
        });
      }

      const [userCheck] = await conn.execute(
        'SELECT email, username, role, is_active FROM users WHERE id = ?',
        [userId]
      );

      if (!userCheck.length) {
        await conn.rollback();
        return res.status(404).json({
          success: false,
          code: 404,
          message: '用户不存在',
          data: null
        });
      }

      const user = userCheck[0];

      if (!user.is_active) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          code: 400,
          message: '用户已被删除',
          data: null
        });
      }

      if (user.role === 'superadministrator') {
        await conn.rollback();
        return res.status(403).json({
          success: false,
          code: 403,
          message: '不能删除超级管理员账户',
          data: null
        });
      }

      await conn.execute(
        `UPDATE users 
         SET is_active = 0,
             deleted_at = NOW(),
             deleted_reason = ?,
             deleted_email = email,
             email = NULL,
             updated_at = NOW()
         WHERE id = ?`,
        [deleted_reason, userId]
      );

      await UserSessionModel.invalidateUserSessions(userId);

      await redisService.del([
        `user:${userId}`,
        `user_sessions:${userId}`
      ]);

      try {
        console.log('准备发送删除通知邮件给用户:', {
          email: user.email,
          username: user.username,
          reason: deleted_reason
        });
        
        const emailContent = emailTemplates.admin.userDeletion(user.username, deleted_reason);
        console.log('邮件内容:', emailContent);
        
        const emailResult = await sendEmail({
          to: user.email,
          ...emailContent
        });
        
        console.log('邮件发送成功:', emailResult);
      } catch (emailError) {
        console.error('邮件发送失败:', {
          error: emailError.message,
          stack: emailError.stack,
          user: user.email
        });
      }

      await conn.commit();

      return res.status(200).json({
        success: true,
        code: 200,
        message: '用户已成功删除',
        data: null
      });
    } catch (error) {
      await conn.rollback();
      console.error('Delete user error:', error);
      return res.status(500).json({
        success: false,
        code: 500,
        message: '删除用户失败，请稍后重试',
        data: null
      });
    } finally {
      conn.release();
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