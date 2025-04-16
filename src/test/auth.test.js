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

jest.mock('../../src/config/email', () => ({
    sendEmail: jest.fn().mockResolvedValue({ messageId: 'mocked-message-id' }),
    transporter: {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'mocked-message-id' }),
        verify: jest.fn().mockResolvedValue(true)
    }
}));

const { sendEmail } = require('../../src/config/email');

describe('Auth API Tests - Single Platform SSO', () => {
    let userId, testUser, server;

    beforeAll(async () => {
        try {
            server = app.listen(0);
            console.log('Test server started on random port');

            // 创建测试用户并保存完整信息
            const email = `testuser_${Date.now()}@example.com`;
            testUser = await UserModel.create({
                username: `testuser_${Date.now()}`,
                email,
                password_hash: await hashPassword('Test123!'),
                timezone: 'Asia/Shanghai'
            });
            userId = testUser.id;
            console.log('Test user created with ID:', userId);
        } catch (error) {
            console.error('Setup error:', error);
            throw error;
        }
    }, 10000);

    beforeEach(async () => {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            // 清理所有相关数据
            await Promise.all([
                conn.execute('DELETE FROM user_sessions WHERE user_id = ?', [userId]),
                conn.execute('DELETE FROM user_login_logs WHERE user_id = ?', [userId])
            ]);

            await conn.commit();

            // 清理所有相关缓存
            await Promise.all([
                redisService.del(`user:${userId}`),
                redisService.del(`user_sessions:${userId}`),
                redisService.del(`user:username:${testUser.username}`),
                redisService.del(`user_login_attempts:${testUser.email}`)
            ]);
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
        jest.clearAllMocks();
    });

    afterAll(async () => {
        console.log('Starting cleanup...');
        try {
            if (userId) {
                await Promise.all([
                    UserModel.deactivateAccount(userId, 'test cleanup'),
                    UserSessionModel.invalidateUserSessions(userId)
                ]);
            }

            await Promise.all([
                new Promise((resolve) => server?.close(resolve)),
                redisService.quit(),
                db.end()
            ]);

            console.log('Cleanup completed successfully.');
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }, 30000);

    describe('Single Platform Single Sign-On Tests', () => {
        test('同一平台多次登录 - 仅保留最新会话', async () => {
            // 第一次登录 (web)
            const login1 = await request(app)
                .post(`${config.apiPrefix}/auth/login`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai')
                .send({
                    email: testUser.email,
                    password: 'Test123!'
                });

            expect(login1.status).toBe(200);
            expect(login1.body.status).toBe('success');
            expect(login1.body.data.token).toBeDefined();
            const webToken1 = login1.body.data.token;

            // 验证会话
            let sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].platform).toBe('web');
            expect(sessions[0].timezone).toBe('Asia/Shanghai');

            // 第二次登录 (web)
            const login2 = await request(app)
                .post(`${config.apiPrefix}/auth/login`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai')
                .send({
                    email: testUser.email,
                    password: 'Test123!'
                });

            expect(login2.status).toBe(200);
            expect(login2.body.status).toBe('success');
            expect(login2.body.data.token).not.toBe(webToken1);
            const webToken2 = login2.body.data.token;

            // 验证旧会话失效，新会话活跃
            sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].platform).toBe('web');

            // 验证旧令牌失效
            const oldSessionResponse = await request(app)
                .get(`${config.apiPrefix}/auth/me`)
                .set('Authorization', `Bearer ${webToken1}`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai');
            expect(oldSessionResponse.status).toBe(401);
            expect(oldSessionResponse.body.message).toBe('会话已失效，请重新登录');

            // 验证新令牌有效
            const newSessionResponse = await request(app)
                .get(`${config.apiPrefix}/auth/me`)
                .set('Authorization', `Bearer ${webToken2}`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai');
            expect(newSessionResponse.status).toBe(200);
            expect(newSessionResponse.body.data.id).toBe(userId);
        });

        test('不同平台同时登录 - 各平台一个活跃会话', async () => {
            const tokens = {};
            const platforms = ['web', 'mobile', 'desktop'];

            // 登录三个平台
            for (const platform of platforms) {
                const login = await request(app)
                    .post(`${config.apiPrefix}/auth/login`)
                    .set('X-Platform', platform)
                    .set('X-Timezone', 'Asia/Shanghai')
                    .send({
                        email: testUser.email,
                        password: 'Test123!'
                    });
                expect(login.status).toBe(200);
                expect(login.body.status).toBe('success');
                tokens[platform] = login.body.data.token;
            }

            // 验证会话
            const sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
            expect(sessions).toHaveLength(3);
            expect(sessions.map(s => s.platform).sort()).toEqual(['desktop', 'mobile', 'web']);
            expect(sessions.every(s => s.timezone === 'Asia/Shanghai')).toBe(true);

            // 验证每个平台令牌有效
            for (const platform of platforms) {
                const response = await request(app)
                    .get(`${config.apiPrefix}/auth/me`)
                    .set('Authorization', `Bearer ${tokens[platform]}`)
                    .set('X-Platform', platform)
                    .set('X-Timezone', 'Asia/Shanghai');
                expect(response.status).toBe(200);
                expect(response.body.data.id).toBe(userId);
                expect(response.body.data.timezone).toBe('Asia/Shanghai');
            }
        });

        test('退出登录 - 仅当前平台会话失效', async () => {
            const tokens = {};
            const platforms = ['web', 'mobile', 'desktop'];

            // 登录三个平台
            for (const platform of platforms) {
                const login = await request(app)
                    .post(`${config.apiPrefix}/auth/login`)
                    .set('X-Platform', platform)
                    .set('X-Timezone', 'Asia/Shanghai')
                    .send({
                        email: testUser.email,
                        password: 'Test123!'
                    });
                expect(login.status).toBe(200);
                tokens[platform] = login.body.data.token;
            }

            // 验证初始会话
            let sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
            expect(sessions).toHaveLength(3);

            // 退出 web 平台
            const logoutResponse = await request(app)
                .post(`${config.apiPrefix}/auth/logout`)
                .set('Authorization', `Bearer ${tokens.web}`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai');
            expect(logoutResponse.status).toBe(200);
            expect(logoutResponse.body.status).toBe('success');
            expect(logoutResponse.body.message).toBe('已成功登出');

            // 验证会话状态
            sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
            expect(sessions).toHaveLength(2);
            expect(sessions.map(s => s.platform).sort()).toEqual(['desktop', 'mobile']);

            // 验证退出日志
            const [logs] = await db.execute(
                'SELECT * FROM user_login_logs WHERE user_id = ? AND success = ? AND platform = ?',
                [userId, true, 'web']
            );
            expect(logs).toHaveLength(1);
            expect(logs[0].platform).toBe('web');

            // 验证其他平台会话有效
            for (const platform of ['mobile', 'desktop']) {
                const response = await request(app)
                    .get(`${config.apiPrefix}/auth/me`)
                    .set('Authorization', `Bearer ${tokens[platform]}`)
                    .set('X-Platform', platform)
                    .set('X-Timezone', 'Asia/Shanghai');
                expect(response.status).toBe(200);
                expect(response.body.data.id).toBe(userId);
            }

            // 验证 web 会话失效
            const webResponse = await request(app)
                .get(`${config.apiPrefix}/auth/me`)
                .set('Authorization', `Bearer ${tokens.web}`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai');
            expect(webResponse.status).toBe(401);
            expect(webResponse.body.message).toBe('会话已失效，请重新登录');
        });

        test('无 x-platform 头 - 默认使用 web 平台', async () => {
            const login = await request(app)
                .post(`${config.apiPrefix}/auth/login`)
                .set('X-Timezone', 'Asia/Shanghai')
                .send({
                    email: testUser.email,
                    password: 'Test123!'
                });

            expect(login.status).toBe(200);
            expect(login.body.status).toBe('success');
            expect(login.body.data.token).toBeDefined();

            const sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].platform).toBe('web');
            expect(sessions[0].timezone).toBe('Asia/Shanghai');
        });

        test('无效 x-platform - 返回错误', async () => {
            const login = await request(app)
                .post(`${config.apiPrefix}/auth/login`)
                .set('X-Platform', 'invalid')
                .set('X-Timezone', 'Asia/Shanghai')
                .send({
                    email: testUser.email,
                    password: 'Test123!'
                });

            expect(login.status).toBe(400);
            expect(login.body.status).toBe('error');
            expect(login.body.message).toBe('无效的平台类型');
        });

        test('无效 x-timezone - 不中断登录流程', async () => {
            const login = await request(app)
                .post(`${config.apiPrefix}/auth/login`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Invalid/Timezone')
                .send({
                    email: testUser.email,
                    password: 'Test123!'
                });

            expect(login.status).toBe(200);
            expect(login.body.status).toBe('success');
            expect(login.body.data.token).toBeDefined();

            const sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].platform).toBe('web');
        });
    });

    describe('Session ID Generation Tests', () => {
        test('创建会话时生成有效的 UUID', async () => {
            const login = await request(app)
                .post(`${config.apiPrefix}/auth/login`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai')
                .send({
                    email: testUser.email,
                    password: 'Test123!'
                });

            expect(login.status).toBe(200);
            expect(login.body.status).toBe('success');

            const sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
            expect(sessions).toHaveLength(1);

            const sessionId = sessions[0].id;
            const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            expect(sessionId).toMatch(uuidV4Regex);
        });

        test('同一用户的多个会话有唯一的 UUID', async () => {
            const sessionIds = new Set();
            const platforms = ['web', 'mobile', 'desktop'];

            for (const platform of platforms) {
                const login = await request(app)
                    .post(`${config.apiPrefix}/auth/login`)
                    .set('X-Platform', platform)
                    .set('X-Timezone', 'Asia/Shanghai')
                    .send({
                        email: testUser.email,
                        password: 'Test123!'
                    });
                expect(login.status).toBe(200);
            }

            const sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
            expect(sessions).toHaveLength(3);

            sessions.forEach(session => {
                expect(sessionIds.has(session.id)).toBe(false);
                sessionIds.add(session.id);
                const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                expect(session.id).toMatch(uuidV4Regex);
            });
        });

        test('会话失效后创建新会话生成新的 UUID', async () => {
            const login1 = await request(app)
                .post(`${config.apiPrefix}/auth/login`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai')
                .send({
                    email: testUser.email,
                    password: 'Test123!'
                });

            expect(login1.status).toBe(200);
            const sessions1 = await UserSessionModel.findActiveSessionsByUserId(userId);
            const firstSessionId = sessions1[0].id;

            await UserSessionModel.invalidateSessionsByPlatform(userId, 'web');

            const login2 = await request(app)
                .post(`${config.apiPrefix}/auth/login`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai')
                .send({
                    email: testUser.email,
                    password: 'Test123!'
                });

            expect(login2.status).toBe(200);
            const sessions2 = await UserSessionModel.findActiveSessionsByUserId(userId);
            const secondSessionId = sessions2[0].id;

            expect(secondSessionId).not.toBe(firstSessionId);
            const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            expect(firstSessionId).toMatch(uuidV4Regex);
            expect(secondSessionId).toMatch(uuidV4Regex);
        });
    });

    describe('Email Functionality Tests', () => {
        test('注册成功时发送欢迎邮件', async () => {
            const email = `newuser_${Date.now()}@example.com`;
            const response = await request(app)
                .post(`${config.apiPrefix}/auth/register`)
                .set('X-Timezone', 'Asia/Shanghai')
                .send({
                    username: `newuser_${Date.now()}`,
                    email,
                    password: 'Test123!',
                    full_name: 'New User'
                });

            expect(response.status).toBe(201);
            expect(response.body.status).toBe('success');
            expect(sendEmail).toHaveBeenCalledTimes(1);
            expect(sendEmail).toHaveBeenCalledWith(
                expect.objectContaining({ to: email })
            );

            // 清理临时用户
            const newUser = await UserModel.findByEmail(email);
            if (newUser) {
                await UserModel.deactivateAccount(newUser.id, 'test cleanup');
            }
        });

        test('重置密码时发送验证码邮件', async () => {
            const response = await request(app)
                .post(`${config.apiPrefix}/auth/reset-password-email`)
                .send({ email: testUser.email });

            expect(response.status).toBe(200);
            expect(response.body.status).toBe('success');
            expect(sendEmail).toHaveBeenCalledTimes(1);
            expect(sendEmail).toHaveBeenCalledWith(
                expect.objectContaining({ to: testUser.email })
            );
        });

        test('账号注销时发送确认邮件', async () => {
            // 先登录获取令牌
            const login = await request(app)
                .post(`${config.apiPrefix}/auth/login`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai')
                .send({
                    email: testUser.email,
                    password: 'Test123!'
                });
            expect(login.status).toBe(200);
            const token = login.body.data.token;

            // 注销
            const response = await request(app)
                .post(`${config.apiPrefix}/auth/deactivate`)
                .set('Authorization', `Bearer ${token}`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai')
                .send({ deleted_reason: 'testing' });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.code).toBe(200);
            expect(response.body.message).toBe('账号已成功注销');
            expect(response.body.data).toBe(null);
            expect(sendEmail).toHaveBeenCalledTimes(1);
            expect(sendEmail).toHaveBeenCalledWith(
                expect.objectContaining({ to: testUser.email })
            );

            // 恢复用户以继续测试
            await UserModel.create({
                ...testUser,
                password_hash: await hashPassword('Test123!')
            });
        });
    });

    describe('Refresh Token Tests', () => {
        test('刷新令牌 - 保持单一平台会话', async () => {
            // 登录 web 平台
            const login = await request(app)
                .post(`${config.apiPrefix}/auth/login`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai')
                .send({
                    email: testUser.email,
                    password: 'Test123!'
                });
            expect(login.status).toBe(200);
            const refreshToken = login.body.data.refresh_token;

            // 刷新令牌
            const refresh = await request(app)
                .post(`${config.apiPrefix}/auth/refresh-token`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai')
                .send({ refresh_token: refreshToken });

            expect(refresh.status).toBe(200);
            expect(refresh.body.status).toBe('success');
            expect(refresh.body.data.token).toBeDefined();
            expect(refresh.body.data.refresh_token).toBeDefined();

            // 验证会话数量未增加
            const sessions = await UserSessionModel.findActiveSessionsByUserId(userId);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].platform).toBe('web');

            // 验证新令牌有效
            const newToken = refresh.body.data.token;
            const response = await request(app)
                .get(`${config.apiPrefix}/auth/me`)
                .set('Authorization', `Bearer ${newToken}`)
                .set('X-Platform', 'web')
                .set('X-Timezone', 'Asia/Shanghai');
            expect(response.status).toBe(200);
            expect(response.body.data.id).toBe(userId);
        });
    });
});