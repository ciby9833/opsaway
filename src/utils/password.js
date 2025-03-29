// utils/password.js
const bcrypt = require('bcrypt');

// 盐的轮数（越高越安全，但也越慢）
const SALT_ROUNDS = 10;

/**
 * 生成密码哈希
 * @param {string} password - 明文密码
 * @returns {Promise<string>} - 返回哈希后的密码
 */
async function hashPassword(password) {
  try {
    if (!password || typeof password !== 'string') {
      throw new Error('密码不能为空且必须是字符串');
    }

    const trimmedPassword = password.trim();
    if (!trimmedPassword) {
      throw new Error('密码不能为空');
    }

    if (trimmedPassword.length < 8) {
      throw new Error('密码长度不能小于8个字符');
    }

    console.log('Hashing password...');
    const hashedPassword = await bcrypt.hash(trimmedPassword, SALT_ROUNDS);
    console.log('Password hashed successfully');
    
    return hashedPassword;
  } catch (error) {
    console.error('Password hashing failed:', error);
    throw error;
  }
}

/**
 * 比较密码是否匹配
 * @param {string} password - 明文密码
 * @param {string} hash - 存储的哈希密码
 * @returns {Promise<boolean>} - 返回是否匹配
 */
async function comparePassword(password, hash) {
  try {
    if (!password || !hash) {
      throw new Error('密码和哈希值都不能为空');
    }
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.error('Password comparison failed:', error);
    throw error;
  }
}

module.exports = {
  hashPassword,
  comparePassword
};