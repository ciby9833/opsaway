const express = require('express');
const router = express.Router();
const { superAdminMiddleware } = require('../middleware/auth');
const AdminController = require('../controllers/admin.controller');

// 用户管理路由
router.get('/manage/users', superAdminMiddleware, AdminController.getUsers);  // 获取用户列表 2025-03-29 20:30
router.put('/manage/users/:userId/status', superAdminMiddleware, AdminController.updateUserStatus); // 更新用户状态 2025-03-29 20:30
router.delete('/manage/users/:userId', superAdminMiddleware, AdminController.deleteUser); // 删除用户 2025-03-29 20:30
router.put('/manage/users/:userId/role', superAdminMiddleware, AdminController.updateUserRole); // 修改用户角色 2025-03-29 20:30

// 会话管理路由
router.get('/manage/sessions', superAdminMiddleware, AdminController.getSessions); // 获取会话列表 2025-03-29 20:30
router.delete('/manage/sessions/:sessionId', superAdminMiddleware, AdminController.terminateSession); // 终止会话 2025-03-29 20:30
router.delete('/manage/users/:userId/sessions', superAdminMiddleware, AdminController.terminateUserSessions); // 终止用户会话 2025-03-29 20:30

// 系统概览路由
router.get('/manage/stats/users', superAdminMiddleware, AdminController.getUserStats); // 获取用户统计 2025-03-29 20:30
router.get('/manage/stats/sessions', superAdminMiddleware, AdminController.getSessionStats);  // 获取会话统计 2025-03-29 20:30

module.exports = router;