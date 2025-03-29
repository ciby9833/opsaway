// models/user.model.js
const db = require('../config/database');  // 引入数据库连接实例
const { v4: uuidv4 } = require('uuid'); // 引入uuid生成器
const bcrypt = require('bcrypt'); // 引入bcrypt加密库
const redisService = require('../config/redis'); // 引入redis服务
const { hashPassword } = require('../utils/password'); // 引入密码哈希函数

class UserModel {
  // 根据id查找用户
  static async findById(id) {
    try {
      // 先尝试从缓存获取
      const cachedUser = await redisService.get(`user:${id}`);
      if (cachedUser) return cachedUser;

      // 缓存不存在，从数据库获取
      const [rows] = await db.execute(
        'SELECT * FROM users WHERE id = ?',
        [id]
      );

      if (rows[0]) {
        // 设置缓存
        await redisService.set(
          `user:${id}`, 
          rows[0], 
          3600 // 缓存1小时
        );
      }

      return rows[0] || null;
    } catch (error) {
      console.error('Error finding user:', error);
      throw error;
    }
  }
  // 创建用户
  static async create({ username, email, password_hash, full_name = null, phone_number = null }) {
    try {
      console.log('Creating user:', {
        username,
        email,
        passwordReceived: !!password_hash,
        full_name,
        phone_number
      });
      console.log('Received arguments:', { username, email, password_hash, full_name, phone_number });

      // 验证必填字段
      if (!password_hash || typeof password_hash !== 'string' || !password_hash.trim()) {
        throw new Error('密码哈希值不能为空');
      }

      if (!email || !email.trim()) {
        throw new Error('邮箱不能为空');
      }

      if (!username || !username.trim()) {
        throw new Error('用户名不能为空');
      }

      const id = uuidv4();
      
      // 构建插入查询
      const query = `
        INSERT INTO users (
          id, username, email, password_hash,
          is_active, role, created_at, updated_at,
          full_name, phone_number, language
        ) VALUES (
          ?, ?, ?, ?,
          1, 'user', NOW(), NOW(),
          ?, ?, 'en'
        )
      `;

      // 执行插入操作
      const [result] = await db.execute(query, [
        id,
        username.trim(),
        email.trim(),
        password_hash,
        full_name ? full_name.trim() : null,
        phone_number ? phone_number.trim() : null
      ]);

      console.log('User created successfully:', { id, email });

      return {
        id,
        username,
        email,
        full_name,
        phone_number,
        language: 'en',
        is_active: 1,
        role: 'user',
        created_at: new Date()
      };
    } catch (error) {
      console.error('Create user error:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        if (error.message.includes('email')) {
          throw new Error('邮箱已被注册');
        }
        throw new Error('用户名已被使用');
      }
      throw error;
    }
  }

  // 根据邮箱查找用户
  static async findByEmail(email) {
    const [rows] = await db.execute(
      `SELECT 
        id, username, email, password_hash, salt,
        is_active, role, created_at, last_login,
        profile_picture, phone_number, full_name,
        bio, location, language
      FROM users 
      WHERE email = ? AND is_active = 1`,
      [email]
    );
    return rows[0];
  }
  // 更新用户最后登录时间
  static async updateLastLogin(userId) {
    try {
      const query = `
        UPDATE users 
        SET last_login = NOW(), updated_at = NOW()
        WHERE id = ?
      `;
      const [result] = await db.execute(query, [userId]);
      
      if (result.affectedRows === 0) {
        throw new Error('用户不存在或更新失败');
      }
      return result;
    } catch (error) {
      throw error;
    }
  }

  // 更新密码 2025-03-29 14:30
  static async updatePassword(email, password_hash) { // 修改为使用 email
    try {
      const query = `
        UPDATE users 
        SET password_hash = ?, 
            updated_at = NOW() 
        WHERE email = ?
      `;
      const [result] = await db.execute(query, [password_hash, email]);
      if (result.affectedRows === 0) {
        throw new Error('用户不存在或更新失败');
      }
      // 获取用户 ID 并清理缓存
      const user = await this.findByEmail(email);
      if (user) {
        await redisService.del(`user:${user.id}`);
      }
    } catch (error) {
      console.error('Update password error:', error);
      throw error;
    }
  }

  // 根据用户名查找用户 2025-03-29 17:30
  static async findByUsername(username) {
    try {
      const cacheKey = `user:username:${username}`;
      const cachedUser = await redisService.get(cacheKey);
      if (cachedUser) return cachedUser;

      const [rows] = await db.execute(
        'SELECT * FROM users WHERE username = ? AND is_active = 1',
        [username]
      );

      if (rows[0]) {
        await redisService.set(cacheKey, rows[0], 3600);
      }
      return rows[0] || null;
    } catch (error) {
      console.error('Error finding user by username:', error);
      throw error;
    }
  }

  // 更新用户信息 2025-03-29 17:30 正在修改
  static async updateProfile(userId, {
    phone_number,
    full_name,
    bio,
    location,
    language,
    profile_picture
  }) {
    try {
      const updates = [];
      const values = [];
      
      const oldUser = await this.findById(userId);
      if (!oldUser) {
        throw new Error('用户不存在');
      }

      // 验证电话号码格式
      if (phone_number !== undefined && phone_number !== null) {
        if (phone_number && !/^\+?\d{8,15}$/.test(phone_number)) {
          throw new Error('无效的电话号码格式');
        }
        updates.push('phone_number = ?');
        values.push(phone_number);
      }

      // 处理其他字段
      if (full_name !== undefined && full_name !== '') {
        updates.push('full_name = ?');
        values.push(full_name ? full_name.trim() : null);
      }
      if (bio !== undefined) {
        updates.push('bio = ?');
        values.push(bio ? bio.trim() : null);
      }
      if (location !== undefined) {
        updates.push('location = ?');
        values.push(location ? location.trim() : null);
      }
      if (language !== undefined) {
        updates.push('language = ?');
        values.push(language);
      }
      if (profile_picture !== undefined) {
        updates.push('profile_picture = ?');
        values.push(profile_picture);
      }

      updates.push('updated_at = NOW()');

      // 如果没有要更新的字段，返回当前用户信息
      if (updates.length === 1) {
        return oldUser;
      }

      // 执行更新
      const query = `
        UPDATE users 
        SET ${updates.join(', ')}
        WHERE id = ?
      `;
      values.push(userId);

      const [result] = await db.execute(query, values);
      if (result.affectedRows === 0) {
        throw new Error('用户不存在或更新失败');
      }

      // 获取并返回更新后的完整用户信息
      const [rows] = await db.execute(
        `SELECT id, username, email, full_name, phone_number, 
                bio, location, language, profile_picture, role,
                created_at, updated_at, last_login
         FROM users 
         WHERE id = ?`,
        [userId]
      );

      const updatedUser = rows[0];

      // 更新缓存
      await redisService.set(`user:${userId}`, updatedUser, 3600);

      return updatedUser;
    } catch (error) {
      console.error('Update profile error:', error);
      throw error;
    }
  }

  // 账号注销 2025-03-29 18:30
  static async deactivateAccount(userId, deletedReason = null) {
    try {
      const user = await this.findById(userId);
      if (!user) {
        throw new Error('用户不存在');
      }

      const query = `
        UPDATE users 
        SET is_active = 0,
            deleted_at = NOW(),
            deleted_reason = ?,
            deleted_email = email,
            email = NULL,
            updated_at = NOW()
        WHERE id = ?
      `;

      const [result] = await db.execute(query, [deletedReason, userId]);
      
      if (result.affectedRows === 0) {
        throw new Error('注销失败');
      }

      // 清除用户缓存
      await redisService.del(`user:${userId}`);
      
      return true;
    } catch (error) {
      console.error('Deactivate account error:', error);
      throw error;
    }
  }
}

module.exports = UserModel;