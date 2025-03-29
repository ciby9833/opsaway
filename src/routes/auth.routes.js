const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { registerValidation, validateLogin, validateRefreshToken } = require('../middleware/validation');
const { authMiddleware } = require('../middleware/auth');

// 注册路由
router.post('/register', registerValidation, authController.register);

// 登录路由
router.post('/login', validateLogin, authController.login);

// 重置密码路由 2025-03-29 14:30
router.post('/reset-password', authController.resetPassword);

// 发送重置密码邮件路由 2025-03-29 14:30    
router.post('/reset-password-email', authController.sendResetPasswordEmail);

// 刷新令牌路由
router.post('/refresh-token', validateRefreshToken, authController.refreshToken);

// google 登录路由 2025-03-29 19:30
router.get('/google', authController.googleLogin);  // google 登录请求
router.get('/google/callback', authController.googleCallback);  // google 登录回调

// 需要认证的路由
router.post('/logout', authMiddleware, authController.logout);
router.get('/sessions', authMiddleware, authController.getUserSessions); // 获取用户的所有会话
router.put('/update-profile', authMiddleware, authController.updateProfile); // 更新用户信息 2025-03-29 17:30
router.get('/me', authMiddleware, authController.getCurrentUser); // 获取当前用户信息 2025-03-29 17:30
router.delete('/deactivate', authMiddleware, authController.deactivateAccount); // 账号注销 2025-03-29 18:30

module.exports = router;