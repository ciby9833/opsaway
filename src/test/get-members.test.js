// test/get-members.test.js
const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database');
const redisService = require('../src/config/redis');
const UserModel = require('../src/models/user.model');
const LicenseModel = require('../src/models/license.model');
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

describe('Get Members API Tests', () => {
  let subscriberId, subscriberToken, memberId, server;

  beforeAll(async () => {
    server = app.listen(0);

    // 创建订阅者
    const subscriber = await UserModel.create({
      username: `subscriber_${Date.now()}`,
      email: `subscriber_${Date.now()}@example.com`,
      password_hash: await hashPassword('Subscriber123'),
      role: 'user'
    });
    subscriberId = subscriber.id;
    const subscriberSessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active) VALUES (?, ?, 1)',
      [subscriberSessionId, subscriberId]
    );
    await redisService.set(`session:${subscriberSessionId}`, { is_active: true }, 3600);
    const subscriberTokens = await generateTokens({ id: subscriberId, role: 'user' }, subscriberSessionId);
    subscriberToken = subscriberTokens.accessToken;

    // 创建有效许可
    await LicenseModel.createLicense(subscriberId, 5, 'year');

    // 创建已注册成员
    const member = await UserModel.create({
      username: `member_${Date.now()}`,
      email: `member_${Date.now()}@example.com`,
      password_hash: await hashPassword('Member123')
    });
    memberId = member.id;
    await MemberModel.addMember(subscriberId, member.email);

    // 创建未注册成员
    await MemberModel.addMember(subscriberId, `unregistered_${Date.now()}@example.com`);

    process.env.EMAIL_TEST_MODE = 'false';
    process.env.EMAIL_USER = 'test@example.com';
    process.env.EMAIL_SENDER_NAME = 'OpsAway Test';
  }, 10000);

  afterAll(async () => {
    jest.useFakeTimers();
    try {
      console.log('Starting cleanup...');
      console.log('Closing server...');
      const serverStart = Date.now();
      await new Promise((resolve) => server.close(resolve));
      console.log(`Server closed in ${Date.now() - serverStart}ms`);

      if (redisService.client.isOpen) {
        console.log('Disconnecting Redis...');
        const redisStart = Date.now();
        await redisService.client.disconnect();
        console.log(`Redis disconnected in ${Date.now() - redisStart}ms`);
      }

      console.log('Closing database connection...');
      const dbEndStart = Date.now();
      await db.end();
      console.log(`Database connection closed in ${Date.now() - dbEndStart}ms`);

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
      await conn.execute('DELETE FROM user_members WHERE user_id = ?', [subscriberId]);
      await conn.execute('DELETE FROM user_licenses WHERE user_id = ?', [subscriberId]);
      await conn.execute('DELETE FROM user_sessions WHERE user_id IN (?, ?)', [subscriberId, memberId]);
      await conn.commit();
      console.log('Database cleared successfully');
    } catch (error) {
      await conn.rollback();
      console.error('Failed to clear database:', error);
      throw error;
    } finally {
      conn.release();
    }
    await redisService.del(`user:license:${subscriberId}`);
    await redisService.del(`user:member:${memberId}`);
    await LicenseModel.createLicense(subscriberId, 5, 'year');
    // 插入已注册成员（使用 memberId）
    const registeredMemberEmail = `member_${Date.now()}@example.com`;
    const registeredMember = await UserModel.create({
      username: `member_${Date.now()}`,
      email: registeredMemberEmail,
      password_hash: await hashPassword('Member123')
    });
    await MemberModel.addMember(subscriberId, registeredMember.email); // member_id 将非 null
    // 插入未注册成员
    await MemberModel.addMember(subscriberId, `unregistered_${Date.now()}@example.com`);
    const members = await MemberModel.getMembers(subscriberId);
    console.log('Members after insertion:', members);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('获取成员列表', async () => {
    const response = await request(app)
      .get('/api/v1/manage/members')
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json');

    console.log('API response:', response.body);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.data).toHaveProperty('members');
    expect(response.body.data.members.length).toBe(2);
    expect(response.body.data.total).toBe(2);

    const member1 = response.body.data.members.find(m => m.member_id !== null);
    expect(member1).toHaveProperty('id');
    expect(member1.user_id).toBe(subscriberId);
    expect(member1.member_id).toBeDefined();
    expect(member1.email).toMatch(/member_\d+@example.com/);
    expect(member1.status).toBe('active');
    expect(member1.created_at).toBeDefined();
    expect(member1.updated_at).toBeDefined();

    const member2 = response.body.data.members.find(m => m.member_id === null);
    expect(member2).toHaveProperty('id');
    expect(member2.user_id).toBe(subscriberId);
    expect(member2.member_id).toBeNull();
    expect(member2.email).toMatch(/unregistered_\d+@example.com/);
    expect(member2.status).toBe('active');
    expect(member2.created_at).toBeDefined();
    expect(member2.updated_at).toBeDefined();
  });

  test('未提供令牌时失败', async () => {
    const response = await request(app)
      .get('/api/v1/manage/members')
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '未提供访问令牌' });
  });

  test('无效令牌时失败', async () => {
    const response = await request(app)
      .get('/api/v1/manage/members')
      .set('Authorization', 'Bearer invalidtoken')
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '无效的访问令牌' });
  });

  test('会话失效时失败', async () => {
    const invalidSessionToken = await generateTokens({ id: subscriberId, role: 'user' }, 'invalid-session-id');
    const response = await request(app)
      .get('/api/v1/manage/members')
      .set('Authorization', `Bearer ${invalidSessionToken.accessToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '会话已失效，请重新登录' });
  });

  test('无有效许可时失败', async () => {
    await db.execute('UPDATE user_licenses SET status = "expired" WHERE user_id = ?', [subscriberId]);
    await redisService.del(`user:license:${subscriberId}`);
    const response = await request(app)
      .get('/api/v1/manage/members')
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ status: 'error', message: '用户许可已过期，请续期' });
  });

  test('服务器错误时失败', async () => {
    const connSpy = jest.spyOn(db, 'getConnection').mockImplementationOnce(() => {
      return {
        beginTransaction: jest.fn().mockResolvedValue(),
        execute: jest.fn().mockImplementation((query) => {
          if (query.includes('user_members')) {
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
      .get('/api/v1/manage/members')
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ status: 'error', message: '服务器错误：获取成员列表失败' });
    connSpy.mockRestore();
  });
});