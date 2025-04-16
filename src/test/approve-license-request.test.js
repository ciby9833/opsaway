// test/super-admin-approve-license-request.test.js
const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database');
const redisService = require('../src/config/redis');
const UserModel = require('../src/models/user.model');
const LicenseRequestModel = require('../src/models/license-request.model');
const LicenseModel = require('../src/models/license.model');
const { generateTokens } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../src/config/email');

// Mock 邮件发送功能
jest.mock('../src/config/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ messageId: 'mocked-message-id' }),
  transporter: { sendMail: jest.fn() }
}));

describe('Super Admin Approve License Request API Tests', () => {
  let superAdminId, superAdminToken, userId, userToken, requestId, server;

  beforeAll(async () => {
    server = app.listen(0);

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

    const licenseRequest = await LicenseRequestModel.createRequest(userId, 5, 'month', 'new');
    requestId = licenseRequest.id;

    process.env.EMAIL_TEST_MODE = 'false';
    process.env.EMAIL_USER = 'test@example.com';
    process.env.EMAIL_SENDER_NAME = 'OpsAway Test';
  }, 10000);

  afterAll(async () => {
    jest.useFakeTimers();
    try {
      console.log('Starting cleanup...');
      
      // 1. 关闭服务器
      await new Promise((resolve) => server.close(resolve));
      
      // 2. 关闭 Redis 连接
      if (redisService.client.isOpen) {
        await redisService.client.disconnect();
      }
      
      // 3. 关闭数据库连接（只使用一种方式）
      await db.end();
      
      console.log('Cleanup completed.');
    } catch (error) {
      console.error('Cleanup error:', error);
    } finally {
      jest.useRealTimers();
    }
  }, 60000);  // 增加超时时间到60秒

  beforeEach(async () => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // 清理数据
      await conn.execute('DELETE FROM license_requests WHERE user_id = ?', [userId]);
      await conn.execute('DELETE FROM user_licenses WHERE user_id = ?', [userId]);
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    
    // Redis 清理 - 添加速率限制计数器的清理
    await Promise.all([
      redisService.del(`user:license:requests:${userId}`),
      redisService.del(`user:license:${userId}`),
      redisService.del(`ratelimit:127.0.0.1`),  // 清理本地测试IP的限制
      redisService.del(`ratelimit:::1`),        // 清理IPv6本地测试IP的限制
      redisService.del(`ratelimit:::ffff:127.0.0.1`)  // 清理IPv4映射到IPv6的限制
    ]);

    // 重新创建许可申请
    const licenseRequest = await LicenseRequestModel.createRequest(userId, 5, 'month', 'new');
    requestId = licenseRequest.id;  // 更新 requestId
  });

  test('超级管理员成功批准许可申请', async () => {
    const response = await request(app)
      .put(`/api/v1/system/manage/license-requests/${requestId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json')
      .send({ action: 'approve' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'success', message: '许可申请已批准' });

    const [requests] = await db.execute(
      'SELECT status, approved_by FROM license_requests WHERE id = ?',
      [requestId]
    );
    expect(requests.length).toBe(1);
    expect(requests[0].status).toBe('approved');
    expect(requests[0].approved_by).toBe(superAdminId);

    const license = await LicenseModel.checkLicenseStatus(userId);
    expect(license).toMatchObject({
      max_members: 5,
      status: 'active'
    });
  });

  test('超级管理员成功拒绝许可申请', async () => {
    const response = await request(app)
      .put(`/api/v1/system/manage/license-requests/${requestId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json')
      .send({ action: 'reject' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'success', message: '许可申请已拒绝' });

    const [requests] = await db.execute(
      'SELECT status, approved_by FROM license_requests WHERE id = ?',
      [requestId]
    );
    expect(requests.length).toBe(1);
    expect(requests[0].status).toBe('rejected');
    expect(requests[0].approved_by).toBe(superAdminId);

    const license = await LicenseModel.checkLicenseStatus(userId);
    expect(license).toBeNull();
  });

  test('未提供令牌时失败', async () => {
    const response = await request(app)
      .put(`/api/v1/system/manage/license-requests/${requestId}`)
      .set('Content-Type', 'application/json')
      .send({ action: 'approve' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '未提供访问令牌' });
  });

  test('无效令牌时失败', async () => {
    const response = await request(app)
      .put(`/api/v1/system/manage/license-requests/${requestId}`)
      .set('Authorization', 'Bearer invalidtoken')
      .set('Content-Type', 'application/json')
      .send({ action: 'approve' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '无效的访问令牌' });
  });

  test('非超级管理员权限时失败', async () => {
    const response = await request(app)
      .put(`/api/v1/system/manage/license-requests/${requestId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'application/json')
      .send({ action: 'approve' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ status: 'error', message: '需要超级管理员权限' });
  });

  test('无效的申请ID时失败', async () => {
    const response = await request(app)
      .put('/api/v1/system/manage/license-requests/invalid-id')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json')
      .send({ action: 'approve' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: 'error', message: '无效的申请 ID' });
  });

  test('申请不存在时失败', async () => {
    const nonExistentId = uuidv4();
    const response = await request(app)
      .put(`/api/v1/system/manage/license-requests/${nonExistentId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json')
      .send({ action: 'approve' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: 'error', message: '申请不存在' });
  });

  test('申请已处理时失败', async () => {
    await LicenseRequestModel.updateRequestStatus(requestId, 'approved', superAdminId);

    const response = await request(app)
      .put(`/api/v1/system/manage/license-requests/${requestId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json')
      .send({ action: 'approve' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: 'error', message: '申请已处理' });
  });

  test('无效操作时失败', async () => {
    const response = await request(app)
      .put(`/api/v1/system/manage/license-requests/${requestId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json')
      .send({ action: 'invalid' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: 'error', message: '无效的操作，必须是 "approve" 或 "reject"' });
  });

  test('数据库失败时返回服务器错误', async () => {
    const dbSpy = jest.spyOn(db, 'execute').mockImplementation((query) => {
      if (query.includes('license_requests') || query.includes('user_licenses')) {
        return Promise.reject(new Error('Database error'));
      }
      return Promise.resolve([[]]);
    });
    const response = await request(app)
      .put(`/api/v1/system/manage/license-requests/${requestId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Content-Type', 'application/json')
      .send({ action: 'approve' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ status: 'error', message: '服务器错误：无法检查许可状态' });
    dbSpy.mockRestore();
  });
});