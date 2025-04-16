const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database');
const redisService = require('../src/config/redis');
const UserModel = require('../src/models/user.model');
const LicenseModel = require('../src/models/license.model');
const LicenseRequestModel = require('../src/models/license-request.model'); // 新增导入
const MemberModel = require('../src/models/member.model');
const { generateTokens } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../src/config/email');

// Mock 邮件发送功能
jest.mock('../src/config/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ messageId: 'mocked-message-id' }),
  transporter: { sendMail: jest.fn() }
}));

describe('License Request API Tests', () => {
  let userId, userToken, userEmail, server;

  beforeAll(async () => {
    server = app.listen(0); // 动态端口
    const user = await UserModel.create({
      username: `testuser_${Date.now()}`,
      email: `testuser_${Date.now()}@example.com`,
      password_hash: await hashPassword('Test123456'),
    });
    userId = user.id;
    userEmail = user.email;

    const sessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active) VALUES (?, ?, 1)',
      [sessionId, userId]
    );
    await redisService.set(`session:${sessionId}`, { is_active: true }, 3600);
    const tokens = await generateTokens({ id: userId, role: 'user' }, sessionId);
    userToken = tokens.accessToken;

    process.env.EMAIL_TEST_MODE = 'false';
    process.env.EMAIL_USER = 'test@example.com';
    process.env.EMAIL_SENDER_NAME = 'OpsAway Test';
  });

  afterAll(async () => {
    try {
      if (userId) {
        await db.execute('DELETE FROM license_requests WHERE user_id = ?', [userId]);
        await db.execute('DELETE FROM user_licenses WHERE user_id = ?', [userId]);
        await db.execute('DELETE FROM user_members WHERE user_id = ? OR member_id = ?', [userId, userId]);
        await db.execute('DELETE FROM users WHERE id = ?', [userId]);
        await db.execute('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE "test%")');
        await db.execute('DELETE FROM users WHERE email LIKE "test%"');
      }
      await db.end();
      await redisService.quit();
      if (server && server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  beforeEach(async () => {
    sendEmail.mockClear();
    // 清理测试用户的成员记录、许可和待处理申请
    await db.execute('DELETE FROM user_members WHERE member_id = ?', [userId]);
    await db.execute('DELETE FROM license_requests WHERE user_id = ?', [userId]);
    await db.execute('DELETE FROM user_licenses WHERE user_id = ?', [userId]);
    await redisService.del(`user:member:${userId}`);
    await redisService.del(`user:license:requests:${userId}`);
    await redisService.del(`user:license:${userId}`);
  });

  test('Should successfully submit a new license request', async () => {
    const response = await request(app)
      .post('/api/v1/auth/license-requests')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'application/json')
      .send({
        requested_members: 5,
        duration: 'year',
        type: 'new'
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('success');
    expect(response.body.message).toBe('订阅申请已提交，等待超级管理员审批');
    expect(response.body.data).toMatchObject({
      requestId: expect.any(String)
    });

    const [requests] = await db.execute(
      'SELECT * FROM license_requests WHERE user_id = ? AND status = "pending"',
      [userId]
    );
    expect(requests.length).toBe(1);
    expect(requests[0]).toMatchObject({
      requested_members: 5,
      duration: 'year',
      type: 'new',
      status: 'pending'
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: expect.any(String),
        subject: 'OpsAway - 新许可申请等待审批',
        html: expect.stringContaining(`用户 ${userEmail.split('@')[0]}（邮箱：${userEmail}，ID：${userId}）`),
        text: expect.stringContaining(`用户 ${userEmail.split('@')[0]}（邮箱：${userEmail}，ID：${userId}）`)
      })
    );
  });

  test('Should fail when no token provided', async () => {
    const response = await request(app)
      .post('/api/v1/auth/license-requests')
      .set('Content-Type', 'application/json')
      .send({
        requested_members: 5,
        duration: 'year',
        type: 'new'
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '未提供访问令牌' });
  });

  test('Should fail with invalid token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/license-requests')
      .set('Authorization', 'Bearer invalidtoken')
      .set('Content-Type', 'application/json')
      .send({
        requested_members: 5,
        duration: 'year',
        type: 'new'
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '无效的访问令牌' });
  });

  test('Should fail with invalid input (negative members and wrong duration)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/license-requests')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'application/json')
      .send({
        requested_members: 0,
        duration: 'week',
        type: 'new'
      });

    expect(response.status).toBe(400);
    expect(response.body.status).toBe('error');
    expect(response.body.message).toBe('订阅申请输入验证失败');
    expect(response.body.errors).toContainEqual({
      type: 'field',
      value: 0,
      msg: '请求的成员数量必须是正整数',
      path: 'requested_members',
      location: 'body'
    });
    expect(response.body.errors).toContainEqual({
      type: 'field',
      value: 'week',
      msg: '时长必须是 "month"、"quarter" 或 "year"',
      path: 'duration',
      location: 'body'
    });
  });

  test('Should fail when user is in another member list', async () => {
    const subscriber = await UserModel.create({
      username: `subscriber_${Date.now()}`,
      email: `subscriber_${Date.now()}@example.com`,
      password_hash: await hashPassword('Test123456'),
    });
    await LicenseModel.createLicense(subscriber.id, 5, 'month');

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'INSERT INTO user_members (id, user_id, member_id, email, status) VALUES (?, ?, ?, ?, "active")',
        [uuidv4(), subscriber.id, userId, userEmail]
      );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    await redisService.del(`user:member:${userId}`);
    const isMember = await UserModel.isInMemberList(userId);
    console.log('isInMemberList result:', isMember);

    const response = await request(app)
      .post('/api/v1/auth/license-requests')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'application/json')
      .send({
        requested_members: 5,
        duration: 'year',
        type: 'new'
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      status: 'error',
      message: '用户已在其他成员列表中，无法申请订阅'
    });
  });

  test('Should fail when user already has an active license for "new" type', async () => {
    await LicenseModel.createLicense(userId, 3, 'month');

    const response = await request(app)
      .post('/api/v1/auth/license-requests')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'application/json')
      .send({
        requested_members: 5,
        duration: 'year',
        type: 'new'
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: 'error',
      message: '用户已拥有有效许可'
    });
  });

  test('Should succeed for "renew" type even with active license', async () => {
    await LicenseModel.createLicense(userId, 3, 'month');
  
    const response = await request(app)
      .post('/api/v1/auth/license-requests')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'application/json')
      .send({
        requested_members: 5,
        duration: 'year',
        type: 'renew'
      });
  
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('success');
    expect(response.body.message).toBe('订阅申请已提交，等待超级管理员审批');
    expect(response.body.data).toMatchObject({
      requestId: expect.any(String)
    });
  
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: expect.any(String),
        subject: 'OpsAway - 新许可申请等待审批',
        html: expect.stringContaining(`用户 ${userEmail.split('@')[0]}（邮箱：${userEmail}，ID：${userId}）`),
        text: expect.stringContaining(`用户 ${userEmail.split('@')[0]}（邮箱：${userEmail}，ID：${userId}）`)
      })
    );
  });

  test('Should fail when user has a pending request', async () => {
    // 先提交一个待处理申请
    await LicenseRequestModel.createRequest(userId, 3, 'month', 'new');
  
    const response = await request(app)
      .post('/api/v1/auth/license-requests')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'application/json')
      .send({
        requested_members: 5,
        duration: 'year',
        type: 'new'
      });
  
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: 'error',
      message: '请先取消待处理的订阅申请后，再提交新的订阅申请，或保留当前申请'
    });
  });

  test('Should get user pending request', async () => {
    await LicenseRequestModel.createRequest(userId, 3, 'month', 'new');
  
    const response = await request(app)
      .get('/api/v1/auth/pending-request')
      .set('Authorization', `Bearer ${userToken}`);
  
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.message).toBe('获取待处理申请成功');
    expect(response.body.data).toMatchObject({
      requestId: expect.any(String),
      requested_members: 3,
      duration: 'month',
      type: 'new',
      status: 'pending'
    });
  });

  test('Should return null when no pending request exists', async () => {
    const response = await request(app)
      .get('/api/v1/auth/pending-request')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.message).toBe('当前无待处理的订阅申请');
    expect(response.body.data).toBeNull();
  });

  test('Should cancel pending request successfully', async () => {
    await LicenseRequestModel.createRequest(userId, 3, 'month', 'new');
  
    const response = await request(app)
      .post('/api/v1/auth/pending-request/cancel')
      .set('Authorization', `Bearer ${userToken}`);
  
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.message).toBe('待处理订阅申请已取消');
  
    const pendingRequest = await LicenseRequestModel.getUserPendingRequest(userId);
    expect(pendingRequest).toBeNull();
  });

  test('Should fail to cancel when no pending request exists', async () => {
    const response = await request(app)
      .post('/api/v1/auth/pending-request/cancel')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: 'error',
      message: '当前无待处理的订阅申请可取消'
    });
  });
});