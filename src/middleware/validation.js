const { body, validationResult } = require('express-validator');

// 注册验证
const registerValidation = [
  body('username')
    .trim()
    .isLength({ min: 2, max: 255 })
    .withMessage('用户名长度必须在2-255字符之间'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8, max: 50 })
    .withMessage('密码长度必须在8-50字符之间')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('密码必须包含大小写字母和数字'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.error('输入验证失败', 400, errors.array());
    }
    next();
  }
];

// 登录验证
const validateLogin = [
  body('email')
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('密码长度不能小于8个字符'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.error('登录输入验证失败', 400, errors.array());
    }
    next();
  }
];

// 刷新令牌验证
const validateRefreshToken = [
  body('refresh_token')
    .notEmpty()
    .withMessage('刷新令牌不能为空'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: '刷新令牌验证失败',
        errors: errors.array()
      });
    }
    next();
  }
];

// 添加忘记密码验证 2025-03-29 14:30
const validateForgotPassword = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail(),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.error('邮箱格式不正确', 400, errors.array());
    }
    next();
  }
];

// 添加重置密码验证 2025-03-29 14:30
const validateResetPassword = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail(),
  body('verificationCode')
    .trim()
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('验证码必须是6位数字'),
  body('newPassword')
    .isLength({ min: 8, max: 50 })
    .withMessage('密码长度必须在8-50字符之间')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('密码必须包含大小写字母和数字'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.error('输入验证失败', 400, errors.array());
    }
    next();
  }
];

// 添加更新用户信息验证 2025-03-29 17:30
const validateUpdateProfile = [
  body('phone_number').optional().matches(/^\+?\d{8,15}$/).withMessage('无效的电话号码格式'),
  body('full_name').optional().isLength({ max: 255 }).withMessage('姓名长度不能超过255字符'),
  body('bio').optional().isLength({ max: 500 }).withMessage('简介长度不能超过500字符'),
  body('location').optional().isLength({ max: 255 }).withMessage('位置长度不能超过255字符'),
  body('language').optional().isIn(['en', 'zh', 'es']).withMessage('无效的语言选项'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: 'error', message: '输入验证失败', errors: errors.array() });
    }
    next();
  }
];

module.exports = {
  registerValidation,
  validateLogin,
  validateRefreshToken,
  validateForgotPassword,
  validateResetPassword,
  validateUpdateProfile
};