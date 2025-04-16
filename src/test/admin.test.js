// src/test/admin.test.js

// test/auth.test.js
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const redisService = require('../../src/config/redis');
const UserModel = require('../../src/models/user.model');
const UserSessionModel = require('../../src/models/user_session.model');
const UserLoginLogModel = require('../../src/models/user_login_log.model');
const { generateTokens } = require('../../src/utils/jwt');
const { hashPassword } = require('../../src/utils/password');
const { v4: uuidv4 } = require('uuid');
const config = require('../../src/config');
const sendEmail = require('../../src/config/email');

// Mock 邮件服务
jest.mock('../config/email', () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

// Mock Redis service
jest.mock('../config/redis', () => ({
    get: jest.fn().mockImplementation((key) => {
        if (key.startsWith('session:')) {
            return Promise.resolve({
                id: 'test-session-id',
                user_id: '11111111-1111-1111-1111-111111111111',
                platform: 'web',
                is_active: 1
            });
        }
        return Promise.resolve(null);
    }),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true)
}));

describe('超级管理员删除用户测试', () => {
    let superAdminToken;
    let normalUserToken;
    let adminUserToken;
    let testUsers = {};
    let db;
    
    beforeAll(async () => {
        db = require('../config/database');
        
        // 创建测试用户
        const users = [
            {
                id: uuidv4(),
                username: 'superadmin',
                email: 'superadmin@test.com',
                role: 'superadministrator',
                is_active: 1
            },
            {
                id: uuidv4(),
                username: 'normaluser',
                email: 'normal@test.com',
                role: 'user',
                is_active: 1
            },
            {
                id: uuidv4(),
                username: 'adminuser',
                email: 'admin@test.com',
                role: 'admin',
                is_active: 1
            },
            {
                id: uuidv4(),
                username: 'inactiveuser',
                email: 'inactive@test.com',
                role: 'user',
                is_active: 0
            }
        ];

        const password_hash = await hashPassword('Test123456');

        // 插入测试用户
        for (const user of users) {
            await db.execute(
                `INSERT INTO users (id, username, email, password_hash, role, is_active, created_at, updated_at) 
                 VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [user.id, user.username, user.email, password_hash, user.role, user.is_active]
            );
            testUsers[user.username] = user;
        }

        // 生成测试会话和令牌
        for (const user of users) {
            const sessionId = uuidv4();
            const { accessToken } = await generateTokens({
                userId: user.id,
                role: user.role,
                sessionId
            });

            // 存储会话信息到 Redis mock
            const mockSession = {
                id: sessionId,
                user_id: user.id,
                platform: 'web',
                is_active: 1
            };

            require('../config/redis').get.mockImplementation((key) => {
                if (key === `session:${sessionId}`) {
                    return Promise.resolve(mockSession);
                }
                return Promise.resolve(null);
            });

            if (user.role === 'superadministrator') {
                superAdminToken = accessToken;
            } else if (user.role === 'admin') {
                adminUserToken = accessToken;
            } else if (user.role === 'user' && user.is_active === 1) {
                normalUserToken = accessToken;
            }
        }
    });

    afterAll(async () => {
        // 清理测试数据
        const userIds = Object.values(testUsers).map(user => user.id);
        await db.execute(
            'DELETE FROM users WHERE id IN (?)',
            [userIds]
        );
        await db.end();
    });

    // 测试场景1: 成功删除普通用户
    test('超级管理员成功删除普通用户', async () => {
        const response = await request(app)
            .delete(`${config.apiPrefix}/system/manage/users/${testUsers.normaluser.id}`)
            .set('Authorization', `Bearer ${superAdminToken}`)
            .set('X-Platform', 'web')
            .send({
                deleted_reason: '违反使用条款'
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            success: true,
            code: 200,
            message: '用户已成功删除',
            data: null
        });

        // 验证数据库更新
        const [rows] = await db.execute(
            'SELECT is_active, deleted_email, email FROM users WHERE id = ?',
            [testUsers.normaluser.id]
        );
        expect(rows[0]).toMatchObject({
            is_active: 0,
            deleted_email: testUsers.normaluser.email,
            email: null
        });

        // 验证邮件发送
        expect(sendEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: testUsers.normaluser.email
            })
        );
    });

    // 测试场景2: 成功删除管理员用户
    test('超级管理员成功删除管理员用户', async () => {
        const response = await request(app)
            .delete(`${config.apiPrefix}/system/manage/users/${testUsers.adminuser.id}`)
            .set('Authorization', `Bearer ${superAdminToken}`)
            .set('X-Platform', 'web')
            .send({
                deleted_reason: '角色调整'
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    // 测试场景3: 尝试删除超级管理员
    test('不能删除超级管理员账户', async () => {
        const response = await request(app)
            .delete(`${config.apiPrefix}/system/manage/users/${testUsers.superadmin.id}`)
            .set('Authorization', `Bearer ${superAdminToken}`)
            .set('X-Platform', 'web')
            .send({
                deleted_reason: '测试删除'
            });

        expect(response.status).toBe(403);
        expect(response.body).toEqual({
            success: false,
            code: 403,
            message: '不能删除超级管理员账户',
            data: null
        });
    });

    // 测试场景4: 尝试删除已删除的用户
    test('不能删除已被删除的用户', async () => {
        const response = await request(app)
            .delete(`${config.apiPrefix}/system/manage/users/${testUsers.inactiveuser.id}`)
            .set('Authorization', `Bearer ${superAdminToken}`)
            .set('X-Platform', 'web')
            .send({
                deleted_reason: '重复删除'
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('用户已被删除');
    });

    // 测试场景5: 无效的用户ID
    test('删除无效的用户ID', async () => {
        const response = await request(app)
            .delete(`${config.apiPrefix}/system/manage/users/invalid-uuid`)
            .set('Authorization', `Bearer ${superAdminToken}`)
            .set('X-Platform', 'web')
            .send({
                deleted_reason: '测试无效ID'
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('无效的用户 ID');
    });

    // 测试场景6: 不存在的用户ID
    test('删除不存在的用户', async () => {
        const response = await request(app)
            .delete(`${config.apiPrefix}/system/manage/users/88888888-8888-8888-8888-888888888888`)
            .set('Authorization', `Bearer ${superAdminToken}`)
            .set('X-Platform', 'web')
            .send({
                deleted_reason: '测试不存在用户'
            });

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('用户不存在');
    });

    // 测试场景7: 权限不足（普通用户尝试删除）
    test('普通用户无权删除用户', async () => {
        const response = await request(app)
            .delete(`${config.apiPrefix}/system/manage/users/${testUsers.adminuser.id}`)
            .set('Authorization', `Bearer ${normalUserToken}`)
            .set('X-Platform', 'web')
            .send({
                deleted_reason: '测试权限'
            });

        expect(response.status).toBe(403);
        expect(response.body.message).toBe('需要超级管理员权限');
    });

    // 测试场景8: 权限不足（管理员尝试删除）
    test('管理员无权删除用户', async () => {
        const response = await request(app)
            .delete(`${config.apiPrefix}/system/manage/users/${testUsers.normaluser.id}`)
            .set('Authorization', `Bearer ${adminUserToken}`)
            .set('X-Platform', 'web')
            .send({
                deleted_reason: '测试权限'
            });

        expect(response.status).toBe(403);
        expect(response.body.message).toBe('需要超级管理员权限');
    });

    // 测试场景9: 未提供删除原因
    test('删除用户时未提供原因', async () => {
        const response = await request(app)
            .delete(`${config.apiPrefix}/system/manage/users/${testUsers.normaluser.id}`)
            .set('Authorization', `Bearer ${superAdminToken}`)
            .set('X-Platform', 'web')
            .send({});

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });
});