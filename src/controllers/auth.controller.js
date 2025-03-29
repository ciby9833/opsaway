const UserModel = require('../models/user.model');
const config = require('../config');
const emailTemplates = require('../templates/index');
const { sendEmail } = require('../config/email');
const { generateTokens } = require('../utils/jwt');
const { hashPassword, comparePassword } = require('../utils/password');
const { getUserDeviceInfo } = require('../utils/device');
const UserSessionModel = require('../models/user_session.model');
const UserLoginLogModel = require('../models/user_login_log.model');
const redisService = require('../config/redis');

// 注册 2025-03-29 14:30
class AuthController {
  async register(req, res) {
    try {
      const { username, email, password, full_name, phone_number } = req.body;
      console.log('Registration request:', { username, email, password: '***', full_name, phone_number });

      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ status: 'error', message: '邮箱已被注册' });
      }

      const password_hash = await hashPassword(password);
      const user = await UserModel.create({ username, email, password_hash, full_name, phone_number });
      console.log('Received request body:', req.body);

      try {
        await sendEmail({ 
          to: email, 
          ...emailTemplates.auth.welcome(full_name || username) 
        });
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
      }

      res.status(201).json({
        status: 'success',
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            full_name: user.full_name,
            phone_number: user.phone_number,
            language: user.language,
            created_at: user.created_at,
            role: user.role,
            profile_picture: user.profile_picture
          }
        }
      });
    } catch (error) {
      console.error(`Registration failed: ${error.message}`);
      res.status(500).json({ status: 'error', message: '注册失败，请稍后重试' });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;
      const platform = req.headers['x-platform'] || 'web';

      const user = await UserModel.findByEmail(email);
      if (!user) {
        return res.status(401).json({ status: 'error', message: '账号不存在或密码错误' });
      }

      if (!user.is_active) {
        return res.status(401).json({ status: 'error', message: '账号已被禁用' });
      }

      const isValidPassword = await comparePassword(password, user.password_hash);
      if (!isValidPassword) {
        await UserLoginLogModel.create({
          user_id: user.id,
          ip_address: req.ip,
          device_info: getUserDeviceInfo(req),
          platform: 'web',
          success: false,
          failure_reason: '密码错误'
        });
        return res.status(401).json({ status: 'error', message: '账号不存在或密码错误' });
      }

      if (config.auth.singleSession) {
        await UserSessionModel.invalidateUserSessions(user.id);
      } else {
        const activeSessionCount = await UserSessionModel.getActiveSessionCount(user.id);
        if (activeSessionCount >= config.auth.maxActiveSessions) {
          return res.status(400).json({ status: 'error', message: '已达到最大登录设备数限制' });
        }
      }

      const session = await UserSessionModel.create({
        user_id: user.id,
        token: null,
        refresh_token: null,
        device_info: getUserDeviceInfo(req),
        platform: platform,
        ip_address: req.ip,
        is_active: 1,
        expires_at: null,
        refresh_token_expires_at: null
      });

      const { accessToken, refreshToken, expiresAt, refreshExpiresAt } = await generateTokens(user, session.id);
      console.log('Generated tokens:', { accessToken, refreshToken, expiresAt, refreshExpiresAt });

      await UserSessionModel.update(session.id, {
        token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        refresh_token_expires_at: refreshExpiresAt
      });

      const userCache = { id: user.id, username: user.username, email: user.email, full_name: user.full_name, role: user.role };
      await redisService.set(`user:${user.id}`, userCache, config.jwt.expiration);

      const sessionCache = { id: session.id, user_id: user.id, token: accessToken, platform: platform, is_active: 1 };
      await redisService.set(`session:${session.id}`, sessionCache, config.jwt.expiration);
      console.log('Cached session:', sessionCache);

      await UserModel.updateLastLogin(user.id);

      await UserLoginLogModel.create({
        user_id: user.id,
        session_id: session.id,
        ip_address: req.ip,
        device_info: getUserDeviceInfo(req),
        platform: 'web',
        success: true
      });

      res.json({
        status: 'success',
        data: {
          token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          refresh_expires_at: refreshExpiresAt,
          user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name, role: user.role }
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ status: 'error', message: '登录失败，请稍后重试' });
    }
  }

  async refreshToken(req, res) {
    try {
      const { refresh_token } = req.body;
      if (!refresh_token) {
        return res.status(400).json({ status: 'error', message: '刷新令牌不能为空' });
      }

      const session = await UserSessionModel.findByRefreshToken(refresh_token);
      if (!session) {
        return res.status(401).json({ status: 'error', message: '无效的刷新令牌' });
      }

      if (new Date() > new Date(session.refresh_token_expires_at)) {
        await UserSessionModel.deleteById(session.id);
        return res.status(401).json({ status: 'error', message: '刷新令牌已过期' });
      }

      const user = await UserModel.findById(session.user_id);
      if (!user || !user.is_active) {
        return res.status(401).json({ status: 'error', message: '用户不存在或已被禁用' });
      }

      const { accessToken, refreshToken, expiresAt, refreshExpiresAt } = await generateTokens(user, session.id);

      await UserSessionModel.update(session.id, {
        token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        refresh_token_expires_at: refreshExpiresAt
      });

      await redisService.set(
        `session:${session.id}`,
        { user_id: user.id, token: accessToken, refresh_token: refreshToken, platform: session.platform, is_active: 1 },
        config.jwt.expiration
      );

      res.json({
        status: 'success',
        data: {
          token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          refresh_expires_at: refreshExpiresAt,
          user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name, role: user.role }
        }
      });
    } catch (error) {
      console.error('刷新令牌错误:', error);
      res.status(500).json({ status: 'error', message: '刷新令牌失败，请稍后重试' });
    }
  }
  //登出 2025-03-29 14:30
  async logout(req, res) {
    try {
      const userId = req.user.id;
      const sessionId = req.sessionId; // 从 auth 中间件注入的 sessionId
      const platform = req.headers['x-platform'] || 'web';

      // 1. 获取用户所有活跃会话
      const sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
      const currentSession = sessions.find(session => session.id === sessionId);
      
      if (!currentSession) {
        return res.error('无效的会话', 400);
      }

      // 2. 筛选出相同平台的会话
      const platformSessions = sessions.filter(session => session.platform === platform);

      // 3. 使用模型提供的方法使会话失效
      for (const session of platformSessions) {
        await UserSessionModel.deleteById(session.id);
      }

      // 4. 清除用户相关的缓存
      await redisService.del(`user:${userId}`);
      await redisService.del(`user_sessions:${userId}`);

      // 5. 记录登出日志
      await UserLoginLogModel.create({
        user_id: userId,
        session_id: sessionId,
        ip_address: req.ip,
        device_info: getUserDeviceInfo(req),
        platform: platform,
        success: true,
        action: 'logout'
      });

      res.success(null, '已成功登出');
    } catch (error) {
      console.error('Logout error:', error);
      res.error('登出失败，请稍后重试', 500);
    }
  }
  //获取会话列表 2025-03-29 14:30
  async getUserSessions(req, res) {
    try {
      const userId = req.user.id;
      const sessions = await UserSessionModel.findActiveSessionsByUserId(userId);

      const sessionsByPlatform = sessions.reduce((acc, session) => {
        const platform = session.platform || 'unknown';
        if (!acc[platform]) acc[platform] = [];
        acc[platform].push({
          id: session.id,
          device_info: session.device_info,
          ip_address: session.ip_address,
          last_active: session.last_active,
          expires_at: session.expires_at,
          is_current: session.id === req.sessionId
        });
        return acc;
      }, {});

      res.json({
        status: 'success',
        data: { sessions: sessionsByPlatform, total_active_sessions: sessions.length }
      });
    } catch (error) {
      console.error('Get sessions error:', error);
      res.status(500).json({ status: 'error', message: '获取会话列表失败' });
    }
  }
  //发送重置密码邮件 2025-03-29 14:30
  async sendResetPasswordEmail(req, res) {
    try {
      const { email } = req.body;
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ status: 'error', message: '无效的邮箱地址' });
      }
      const cooldownKey = `reset_password_cooldown:${email}`;
      if (await redisService.get(cooldownKey)) {
        return res.status(429).json({ status: 'error', message: '请等待1分钟后再重试' });
      }

      const user = await UserModel.findByEmail(email);
      if (!user) {
        return res.status(400).json({ status: 'error', message: '邮箱不存在' });
      }

      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      await redisService.set(`reset_password:${email}`, verificationCode, 60 * 10); // 10分钟有效

      await sendEmail({ 
        to: email, 
        ...emailTemplates.auth.resetPassword(user.username, verificationCode) 
      });

      res.json({ status: 'success', message: '重置密码邮件已发送' });
    } catch (error) {
      console.error('Send reset password email error:', error);
      res.status(500).json({ status: 'error', message: '发送重置密码邮件失败，请稍后重试' });
    }
  }

    //重置密码 2025-03-29 14:30
    async resetPassword(req, res) {
      try {
        const { email, verificationCode, newPassword } = req.body; 
        if (!email || !verificationCode || !newPassword) { //邮箱、验证码和新密码均为必填项
          return res.status(400).json({ status: 'error', message: '邮箱、验证码和新密码均为必填项' });
        }
        const storedCode = await redisService.get(`reset_password:${email}`);  //验证码错误或已过期
        if (!storedCode || storedCode !== verificationCode) {
          return res.status(400).json({ status: 'error', message: '验证码错误或已过期' });  //验证码错误或已过期
        }
        const user = await UserModel.findByEmail(email);  //用户不存在
        if (!user) {
          return res.status(400).json({ status: 'error', message: '用户不存在' });  //用户不存在
        }
        const hashedPassword = await hashPassword(newPassword);  //新密码哈希
        await UserModel.updatePassword(email, hashedPassword); // 使用 email 调用
        await UserSessionModel.invalidateUserSessions(user.id); // 使指定用户的所有会话失效
        await redisService.del(`reset_password:${email}`); // 删除 Redis 中的验证码缓存
        res.json({ status: 'success', message: '密码已重置，所有会话已失效' }); // 返回成功消息
      } catch (error) {
        console.error('Reset password error:', error); // 错误日志
        res.status(500).json({ status: 'error', message: '重置密码失败，请稍后重试' }); // 返回错误消息
      }
    }

    //更新用户信息 2025-03-29 17:30
    async updateProfile(req, res) {
      try {
        const userId = req.user.id;
        const { phone_number, full_name, bio, location, language, profile_picture } = req.body;

        const updatedUser = await UserModel.updateProfile(userId, {
          phone_number,
          full_name,
          bio,
          location,
          language,
          profile_picture
        });

        res.success(updatedUser, '个人资料更新成功');
      } catch (error) {
        console.error('Update profile error:', error);
        res.error(error.message, 400);
      }
    }

    // 获取当前用户信息 2025-03-29 17:30
    async getCurrentUser(req, res) {
      try {
        const userId = req.user.id;
        const user = await UserModel.findById(userId);
        
        if (!user) {
          return res.error('用户不存在', 404);
        }

        res.success({
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          phone_number: user.phone_number,
          bio: user.bio,
          location: user.location,
          language: user.language,
          profile_picture: user.profile_picture,
          role: user.role,
          created_at: user.created_at,
          updated_at: user.updated_at,
          last_login: user.last_login
        }, '获取用户信息成功');
      } catch (error) {
        console.error('Get current user error:', error);
        res.error('获取用户信息失败', 500);
      }
    }

    // 账号注销
    async deactivateAccount(req, res) {
      try {
        const userId = req.user.id;
        const { deleted_reason } = req.body;

        // 先获取用户信息（包括邮箱），用于后续发送邮件
        const user = await UserModel.findById(userId);
        if (!user) {
          return res.error('用户不存在', 404);
        }
        
        const userEmail = user.email; // 保存邮箱，因为注销后会被清空
        const username = user.username;

        // 注销账号
        await UserModel.deactivateAccount(userId, deleted_reason);
        
        // 使所有会话失效
        await UserSessionModel.invalidateUserSessions(userId);

        // 发送注销确认邮件
        try {
          await sendEmail({
            to: userEmail,
            ...emailTemplates.auth.accountDeactivation(username)
          });
        } catch (emailError) {
          console.error('Failed to send deactivation email:', emailError);
        }

        res.success(null, '账号已成功注销');
      } catch (error) {
        console.error('Account deactivation error:', error);
        res.error('账号注销失败', 500);
      }
    }
}

module.exports = new AuthController();