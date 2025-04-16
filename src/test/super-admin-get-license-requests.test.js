// test/super-admin-get-license-requests.test.js
const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database');
const redisService = require('../src/config/redis');
const UserModel = require('../src/models/user.model');
const LicenseRequestModel = require('../src/models/license-request.model');
const { generateTokens } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../src/config/email');

// Mock 邮件发送功能
jest.mock('../src/config/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ messageId: 'mocked-message-id' }),
  transporter: { sendMail: jest.fn() }
}));

describe('Super Admin Get License Requests API Tests', () => {
  let superAdminId, superAdminToken, userId, userToken, server;

  beforeAll(async () => {
    server = app.listen(0);

    // 创建超级管理员
    const superAdmin = await UserModel.create({
      username: `superadmin_${Date.now()}`,
      email: `superadmin_${Date.now()}@example.com`,
      password_hash: await hashPassword('SuperAdmin123'),
      role: 'superadministrator'
    });
    superAdminId = superAdmin.id;
    const superAdminSessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active) VALUES (?, ?, 1)',
      [superAdminSessionId, superAdminId]
    );
    await redisService.set(`session:${superAdminSessionId}`, { is_active: true }, 3600);
    const superAdminTokens = await generateTokens({ id: superAdminId, role: 'superadministrator' }, superAdminSessionId);
    superAdminToken = superAdminTokens.accessToken;

    // 创建普通用户
    const user = await UserModel.create({
      username: `user_${Date.now()}`,
      email: `user_${Date.now()}@example.com`,
      password_hash: await hashPassword('User123456')
    });
    userId = user.id;
    const userSessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active) VALUES (?, ?, 1)',
      [userSessionId, userId]
    );
    await redisService.set(`session:${userSessionId}`, { is_active: true }, 3600);
    const userTokens = await generateTokens({ id: userId, role: 'user' }, userSessionId);
    userToken = userTokens.accessToken;

    // 创建多个许可申请用于测试分页
    await Promise.all([
      LicenseRequestModel.createRequest(userId, 5, 'month', 'new'),
      LicenseRequestModel.createRequest(userId, 3, 'year', 'renew'),
      LicenseRequestModel.createRequest(userId, 10, 'quarter', 'add')
    ]);

    process.env.EMAIL_TEST_MODE = 'false';
    process.env.EMAIL_USER = 'test@example.com';
    process.env.EMAIL_SENDER_NAME = 'OpsAway Test';
  }, 10000);

  afterAll(async () => {
    jest.useFakeTimers();
    try {
      console.log('Starting cleanup...');

      // 1. 先关闭服务器
      console.log('Closing server...');
      await new Promise((resolve) => server.close(resolve));

      // 2. 关闭 Redis 连接
      if (redisService.client.isOpen) {
        console.log('Disconnecting Redis...');
        await redisService.client.disconnect();
      }

      // 3. 关闭数据库连接（只调用一次）
      console.log('Closing database connection...');
      await db.end();  // 移除 db.pool.end()

      console.log('Cleanup completed.');
      jest.runAllTimers();
    } catch (error) {
      console.error('Cleanup error:', error);
    } finally {
      jest.useRealTimers();
    }
  }, 30000);

  beforeEach(async () => {
    sendEmail.mockClear();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM license_requests');
      await conn.execute('DELETE FROM user_licenses');
      await conn.execute('DELETE FROM user_members');
      await conn.execute('DELETE FROM user_sessions WHERE user_id IN (?, ?)', [superAdminId, userId]);
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    await redisService.del(`user:license:requests:${userId}`);
    await redisService.del(`user:license:${userId}`);
    await Promise.all([
      LicenseRequestModel.createRequest(userId, 5, 'month', 'new'),
      LicenseRequestModel.createRequest(userId, 3, 'year', 'renew'),
      LicenseRequestModel.createRequest(userId, 10, 'quarter', 'add')
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks(); // 确保每次测试后恢复模拟
  });

  test('获取默认分页列表', async () => {
    const response = await request(app)
      .get(`/api/v1/system/manage/license-requests`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.data).toHaveProperty('requests');
    expect(response.body.data.requests.length).toBeGreaterThan(0);
    expect(response.body.data.total).toBeGreaterThanOrEqual(3);
    expect(response.body.data.page).toBe(1);
    expect(response.body.data.limit).toBe(10);

    const requestItem = response.body.data.requests[0];
    expect(requestItem).toHaveProperty('id');
    expect(requestItem).toHaveProperty('user_id', userId);
    expect(requestItem).toHaveProperty('email');
    expect(requestItem).toHaveProperty('username');
    expect(requestItem).toHaveProperty('requested_members');
    expect(requestItem).toHaveProperty('duration');
    expect(requestItem).toHaveProperty('type');
    expect(requestItem).toHaveProperty('status', 'pending');
    expect(requestItem).toHaveProperty('approved_by', null);
    expect(requestItem).toHaveProperty('approved_at', null);
    expect(requestItem).toHaveProperty('created_at');
    expect(requestItem).toHaveProperty('updated_at');
  });

  test('获取指定分页列表', async () => {
    const response = await request(app)
      .get(`/api/v1/system/manage/license-requests?page=2&limit=2`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.data.requests.length).toBeLessThanOrEqual(2);
    expect(response.body.data.total).toBeGreaterThanOrEqual(3);
    expect(response.body.data.page).toBe(2);
    expect(response.body.data.limit).toBe(2);
  });

  test('未提供令牌时失败', async () => {
    const response = await request(app)
      .get(`/api/v1/system/manage/license-requests`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '未提供访问令牌' });
  });

  test('无效令牌时失败', async () => {
    const response = await request(app)
      .get(`/api/v1/system/manage/license-requests`)
      .set('Authorization', 'Bearer invalidtoken')
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '无效的访问令牌' });
  });

  test('会话失效时失败', async () => {
    const invalidSessionToken = await generateTokens({ id: superAdminId, role: 'superadministrator' }, 'invalid-session-id');
    const response = await request(app)
      .get(`/api/v1/system/manage/license-requests`)
      .set('Authorization', `Bearer ${invalidSessionToken.accessToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '会话已失效，请重新登录' });
  });

  test('非超级管理员权限时失败', async () => {
    const response = await request(app)
      .get(`/api/v1/system/manage/license-requests`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ status: 'error', message: '需要超级管理员权限' });
  });

  test('无效分页参数时失败', async () => {
    const response = await request(app)
      .get(`/api/v1/system/manage/license-requests?page=-1&limit=abc`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: 'error', message: 'Page must be a positive integer' });
  });

  test('服务器错误时失败', async () => {
    const connSpy = jest.spyOn(db, 'getConnection').mockImplementation(() => {
      return {
        beginTransaction: jest.fn().mockResolvedValue(),
        execute: jest.fn().mockImplementation((query) => {
          if (query.includes('license_requests')) {
            return Promise.reject(new Error('Database error'));
          }
          return Promise.resolve([[]]);
        }),
        commit: jest.fn().mockResolvedValue(),
        rollback: jest.fn().mockResolvedValue(),
        release: jest.fn()
      };
    });

    const response = await request(app)
      .get(`/api/v1/system/manage/license-requests`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ status: 'error', message: '服务器错误：获取许可申请列表失败' });
    connSpy.mockRestore();
  });
});