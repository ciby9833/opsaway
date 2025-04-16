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
const passport = require('../config/passport');

// 注册 2025-03-29 14:30
class AuthController {
  async register(req, res) {
    try {

      // 1. 保持原有的用户注册逻辑
      const rawEmail = req.body.email;
      const { username, password, full_name, phone_number } = req.body;
      const timezone = req.headers['x-timezone'];

      // 2. 验证邮箱格式
      if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        return res.status(400).json({ 
          status: 'error', 
          message: '无效的邮箱格式' 
        });
      }

      const email = rawEmail.trim();

      // 3. 检查邮箱是否已注册
      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ status: 'error', message: '邮箱已被注册' });
      }

      // 4. 创建用户
      const password_hash = await hashPassword(password);
      const user = await UserModel.create({ 
        username, 
        email,
        password_hash, 
        full_name, 
        phone_number,
        timezone 
      });

      // 6. 发送欢迎邮件
      try {
        await sendEmail({ 
          to: email,
          ...emailTemplates.auth.welcome(full_name || username) 
        });
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
      }

      // 8. 返回响应
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
            timezone: user.timezone,
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
        const timezone = req.headers['x-timezone'];

        // 验证用户
        const user = await UserModel.findByEmail(email);
        if (!user || !user.is_active) {
            return res.status(401).json({
                status: 'error',
                message: '账号不存在或已被禁用'
            });
        }

        // 验证密码
        const isValidPassword = await comparePassword(password, user.password_hash);
        if (!isValidPassword) {
            await UserLoginLogModel.create({
                user_id: user.id,
                ip_address: req.ip,
                device_info: getUserDeviceInfo(req),
                platform: platform,
                success: false,
                failure_reason: '密码错误'
            });
            return res.status(401).json({
                status: 'error',
                message: '账号不存在或密码错误'
            });
        }

        // 处理时区
        if (timezone) {
            try {
                await UserModel.updateTimezone(user.id, timezone);
                user.timezone = timezone;
            } catch (timezoneError) {
                console.warn('Invalid timezone:', timezoneError);
                // 继续登录流程，不中断
            }
        }

        // 使同平台旧会话失效
        await UserSessionModel.invalidateSessionsByPlatform(user.id, platform);

        // 创建新会话
        const session = await UserSessionModel.create({
            user_id: user.id,
            device_info: getUserDeviceInfo(req),
            platform: platform,
            ip_address: req.ip,
            timezone: user.timezone
        });

        const { accessToken, refreshToken, expiresAt, refreshExpiresAt } = 
            await generateTokens(user, session.id);

        // 更新会话信息
        await UserSessionModel.update(session.id, {
            token: accessToken,
            refresh_token: refreshToken,
            expires_at: expiresAt,
            refresh_token_expires_at: refreshExpiresAt
        });

        // 更新缓存
        await redisService.set(
            `session:${session.id}`,
            {
                id: session.id,
                user_id: user.id,
                token: accessToken,
                platform: platform,
                is_active: 1,
                timezone: user.timezone
            },
            config.jwt.expiration
        );

        // 更新用户最后登录时间
        await UserModel.updateLastLogin(user.id);

        // 记录登录日志
        await UserLoginLogModel.create({
            user_id: user.id,
            session_id: session.id,
            ip_address: req.ip,
            device_info: getUserDeviceInfo(req),
            platform: platform,
            success: true
        });

        res.json({
            status: 'success',
            data: {
                token: accessToken,
                refresh_token: refreshToken,
                expires_at: expiresAt,
                refresh_expires_at: refreshExpiresAt,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    full_name: user.full_name,
                    role: user.role,
                    timezone: user.timezone
                }
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            status: 'error',
            message: '登录失败，请稍后重试'
        });
    }
  }
  
  // 刷新令牌 2025-04-13 17:00
  async refreshToken(req, res) {
    try {
        const { refresh_token } = req.body;
        const platform = req.headers['x-platform'] || 'web';  // 保持与登录一致的平台处理
        const timezone = req.headers['x-timezone'];

        if (!refresh_token) {
            return res.status(400).json({
                status: 'error',
                message: '刷新令牌不能为空'
            });
        }

        const session = await UserSessionModel.findByRefreshToken(refresh_token);
        if (!session) {
            return res.status(401).json({
                status: 'error',
                message: '无效的刷新令牌'
            });
        }

        // 优化过期时间检查
        if (new Date() > new Date(session.refresh_token_expires_at)) {
            await UserSessionModel.deleteById(session.id);
            return res.status(401).json({
                status: 'error',
                message: '刷新令牌已过期'
            });
        }

        const user = await UserModel.findById(session.user_id);
        if (!user || !user.is_active) {
            return res.status(401).json({
                status: 'error',
                message: '用户不存在或已被禁用'
            });
        }

        // 优化时区处理
        if (timezone && timezone !== user.timezone) {
            try {
                await UserModel.updateTimezone(user.id, timezone);
                user.timezone = timezone;
            } catch (timezoneError) {
                console.warn('Invalid timezone:', timezoneError);
                // 继续处理，不中断流程
            }
        }

        const { accessToken, refreshToken, expiresAt, refreshExpiresAt } = 
            await generateTokens(user, session.id);

        // 更新会话
        await UserSessionModel.update(session.id, {
            token: accessToken,
            refresh_token: refreshToken,
            expires_at: expiresAt,
            refresh_token_expires_at: refreshExpiresAt
        });

        // 优化缓存更新
        const sessionCache = {
            id: session.id,
            user_id: user.id,
            token: accessToken,
            platform: session.platform,
            is_active: 1,
            timezone: user.timezone
        };
        await redisService.set(`session:${session.id}`, sessionCache, config.jwt.expiration);

        res.json({
            status: 'success',
            data: {
                token: accessToken,
                refresh_token: refreshToken,
                expires_at: expiresAt,
                refresh_expires_at: refreshExpiresAt,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    full_name: user.full_name,
                    role: user.role,
                    timezone: user.timezone
                }
            }
        });
    } catch (error) {
        console.error('刷新令牌错误:', error);
        res.status(500).json({
            status: 'error',
            message: '刷新令牌失败，请稍后重试'
        });
    }
  }
  //登出 2025-03-29 14:30
  async logout(req, res) {
    try {
        const userId = req.user.id;
        const sessionId = req.sessionId;
        const platform = req.headers['x-platform']; // 依据请求识别

        const sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
        const currentSession = sessions.find(session => session.id === sessionId);
        
        if (!currentSession) {
            return res.status(400).json({
                status: 'error',
                message: '无效的会话'
            });
        }

        // 使用平台的会话失效
        await UserSessionModel.invalidateSessionsByPlatform(userId, platform);

        // 清除缓存
        await redisService.del(`user:${userId}`);
        await redisService.del(`user_sessions:${userId}`);

        // 记录登出日志
        await UserLoginLogModel.create({
            user_id: userId,
            session_id: sessionId,
            ip_address: req.ip,
            device_info: getUserDeviceInfo(req),
            platform: platform,
            success: true,
            action: 'logout'
        });

        res.json({
            status: 'success',
            message: '已成功登出'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            status: 'error',
            message: '登出失败，请稍后重试'
        });
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
          is_current: session.id === req.sessionId,
          timezone: session.timezone  // 添加时区信息 
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
        const { 
          phone_number, 
          full_name, 
          bio, 
          location, 
          language, 
          profile_picture,
          timezone  // 从请求体获取时区
        } = req.body;

        // 验证时区格式（如果提供了时区）
        if (timezone) {
          try {
            Intl.DateTimeFormat(undefined, { timeZone: timezone });
          } catch (e) {
            return res.status(400).json({ 
              status: 'error', 
              message: '无效的时区格式' 
            });
          }
        }

        const updatedUser = await UserModel.updateProfile(userId, {
          phone_number,
          full_name,
          bio,
          location,
          language,
          profile_picture,
          timezone  // 传递时区到模型方法
        });

        res.json({
          status: 'success',
          message: '个人资料更新成功',
          data: {
            user: {
              id: updatedUser.id,
              username: updatedUser.username,
              email: updatedUser.email,
              full_name: updatedUser.full_name,
              phone_number: updatedUser.phone_number,
              bio: updatedUser.bio,
              location: updatedUser.location,
              language: updatedUser.language,
              timezone: updatedUser.timezone,  // 确保返回更新后的时区
              profile_picture: updatedUser.profile_picture,
              role: updatedUser.role,
              created_at: updatedUser.created_at,
              updated_at: updatedUser.updated_at
            }
          }
        });
      } catch (error) {
        console.error('Update profile error:', error);
        res.status(400).json({ 
          status: 'error', 
          message: error.message || '更新个人资料失败' 
        });
      }
    }

    // 获取当前用户信息 2025-03-29 17:30
    async getCurrentUser(req, res) {
      try {
        const userId = req.user.id;
        const user = await UserModel.findById(userId);
        
        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: '用户不存在'
            });
        }

        res.json({
            status: 'success',
            message: '获取用户信息成功',
            data: {
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
                last_login: user.last_login,
                timezone: user.timezone
            }
        });
      } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({
            status: 'error',
            message: '获取用户信息失败'
        });
      }
    }

    // 账号注销
    async deactivateAccount(req, res) {
      try {
        const userId = req.user.id;
        const { deleted_reason } = req.body;

        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                code: 404,
                message: '用户不存在',
                data: null
            });
        }

        const userEmail = user.email;
        const username = user.username;

        await UserModel.deactivateAccount(userId, deleted_reason);
        await UserSessionModel.invalidateUserSessions(userId);

        try {
            await sendEmail({
                to: userEmail,
                ...emailTemplates.auth.accountDeactivation(username)
            });
        } catch (emailError) {
            console.error('Failed to send deactivation email:', emailError);
        }

        return res.status(200).json({
            success: true,
            code: 200,
            message: '账号已成功注销',
            data: null
        });
      } catch (error) {
        console.error('Account deactivation error:', error);
        return res.status(500).json({
            success: false,
            code: 500,
            message: '账号注销失败，请稍后重试',
            data: null
        });
      }
    }

    // google 登录 2025-03-29 19:30
    // 发起 Google 登录
  googleLogin(req, res, next) {
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  }

  // Google 回调处理
  async googleCallback(req, res, next) {
    passport.authenticate('google', { session: false }, async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ status: 'error', message: 'Google 登录失败' });
        }

        try {
            const platform = req.headers['x-platform'];
            const timezone = req.headers['x-timezone'];

            // 验证平台
            if (!UserSessionModel.PLATFORMS.includes(platform)) {
                return res.status(400).json({ status: 'error', message: '无效的平台类型' });
            }

            // 更新用户时区（如果提供）
            if (timezone) {
                try {
                    await UserModel.updateTimezone(user.id, timezone);
                    user.timezone = timezone;
                } catch (timezoneError) {
                    console.error('Failed to update timezone:', timezoneError);
                }
            }

            // 使同一平台的旧会话失效
            await UserSessionModel.invalidateSessionsByPlatform(user.id, platform);

            // 创建新会话
            const session = await UserSessionModel.create({
                user_id: user.id,
                token: null,
                refresh_token: null,
                device_info: getUserDeviceInfo(req),
                platform,
                ip_address: req.ip,
                is_active: 1,
                expires_at: null,
                refresh_token_expires_at: null,
                timezone: user.timezone
            });

            const { accessToken, refreshToken, expiresAt, refreshExpiresAt } = await generateTokens(user, session.id);
            await UserSessionModel.update(session.id, {
                token: accessToken,
                refresh_token: refreshToken,
                expires_at: expiresAt,
                refresh_token_expires_at: refreshExpiresAt,
                timezone: user.timezone
            });

            const userCache = { 
                id: user.id, 
                username: user.username, 
                email: user.email, 
                full_name: user.full_name, 
                role: user.role,
                timezone: user.timezone
            };
            await redisService.set(`user:${user.id}`, userCache, config.jwt.expiration);

            const sessionCache = { 
                id: session.id, 
                user_id: user.id, 
                token: accessToken, 
                platform, 
                is_active: 1,
                timezone: user.timezone
            };
            await redisService.set(`session:${session.id}`, sessionCache, config.jwt.expiration);

            await UserModel.updateLastLogin(user.id);

            res.json({
                status: 'success',
                data: {
                    token: accessToken,
                    refresh_token: refreshToken,
                    expires_at: expiresAt,
                    refresh_expires_at: refreshExpiresAt,
                    session_id: session.id, // 新增
                    user: { 
                        id: user.id, 
                        username: user.username, 
                        email: user.email, 
                        full_name: user.full_name, 
                        role: user.role,
                        timezone: user.timezone
                    }
                }
            });
        } catch (error) {
            console.error('Google callback error:', error);
            res.status(500).json({ status: 'error', message: 'Google 登录失败，请稍后重试' });
        }
    })(req, res, next);
  }
}

module.exports = new AuthController();