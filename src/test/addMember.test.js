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

describe('Add Member API Tests', () => {
  let subscriberId, subscriberToken, server;

  beforeAll(async () => {
    server = app.listen(0); // 动态端口
    const subscriber = await UserModel.create({
      username: `testsubscriber_${Date.now()}`,
      email: `testsubscriber_${Date.now()}@example.com`,
      password_hash: await hashPassword('Test123456'),
    });
    subscriberId = subscriber.id;

    await LicenseModel.createLicense(subscriberId, 5, 'month');
    const sessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active) VALUES (?, ?, 1)',
      [sessionId, subscriberId]
    );
    await redisService.set(`session:${sessionId}`, { is_active: true }, 3600);
    const tokens = await generateTokens({ id: subscriberId, role: 'user' }, sessionId);
    subscriberToken = tokens.accessToken;
  });

  afterAll(async () => {
    try {
      await db.execute('DELETE FROM user_licenses WHERE user_id = ?', [subscriberId]);
      await db.execute('DELETE FROM user_members WHERE user_id = ?', [subscriberId]);
      await db.execute('DELETE FROM users WHERE id = ?', [subscriberId]);
      await db.execute('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE "test%")');
      await db.execute('DELETE FROM users WHERE email LIKE "test%"');
      await db.end();
      await redisService.quit();
      await new Promise((resolve) => server.close(resolve));
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  test('Should successfully add a member', async () => {
    const email = `member_${Date.now()}@example.com`;
    const response = await request(app)
      .post('/api/v1/manage/members')
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json')
      .send({ email });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('success');
    expect(response.body.message).toBe('成员已添加');
    expect(response.body.data).toMatchObject({
      id: expect.any(String),
      user_id: subscriberId,
      member_id: null,
      email,
      status: 'active'
    });

    const [members] = await db.execute(
      'SELECT * FROM user_members WHERE user_id = ? AND email = ?',
      [subscriberId, email]
    );
    expect(members.length).toBe(1);
    expect(members[0].status).toBe('active');
  });

  test('Should fail when no token provided', async () => {
    const response = await request(app)
      .post('/api/v1/manage/members')
      .set('Content-Type', 'application/json')
      .send({ email: 'test@example.com' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '未提供访问令牌' });
  });

  test('Should fail with invalid token', async () => {
    const response = await request(app)
      .post('/api/v1/manage/members')
      .set('Authorization', 'Bearer invalidtoken')
      .set('Content-Type', 'application/json')
      .send({ email: 'test@example.com' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '无效的访问令牌' });
  });

  test('Should fail with invalid email', async () => {
    const response = await request(app)
      .post('/api/v1/manage/members')
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json')
      .send({ email: 'invalid-email' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: 'error', message: '无效的邮箱地址' });
  });

  test('Should fail when license is expired', async () => {
    const expiredSubscriber = await UserModel.create({
      username: `expiredsubscriber_${Date.now()}`,
      email: `expiredsubscriber_${Date.now()}@example.com`,
      password_hash: await hashPassword('Test123456'),
    });
    await LicenseModel.createLicense(expiredSubscriber.id, 5, 'month');
    await db.execute(
      'UPDATE user_licenses SET status = "expired" WHERE user_id = ?',
      [expiredSubscriber.id]
    );
    await LicenseModel.cacheLicense(expiredSubscriber.id, {
      ...(await LicenseModel.checkLicenseStatus(expiredSubscriber.id)),
      status: 'expired'
    });
    const sessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active) VALUES (?, ?, 1)',
      [sessionId, expiredSubscriber.id]
    );
    await redisService.set(`session:${sessionId}`, { is_active: true }, 3600);
    const tokens = await generateTokens({ id: expiredSubscriber.id, role: 'user' }, sessionId);

    const response = await request(app)
      .post('/api/v1/manage/members')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ email: `expiredmember_${Date.now()}@example.com` });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ status: 'error', message: '用户许可已过期，请续期' });
  });

  test('Should fail when member limit is reached', async () => {
    await db.execute(
      'UPDATE user_licenses SET current_members = 5 WHERE user_id = ?',
      [subscriberId]
    );
    const updatedLicense = { ...(await LicenseModel.checkLicenseStatus(subscriberId)), current_members: 5 };
    await redisService.set(`user:license:${subscriberId}`, updatedLicense, 3600);

    const response = await request(app)
      .post('/api/v1/manage/members')
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json')
      .send({ email: `limitmember_${Date.now()}@example.com` });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ status: 'error', message: '成员数量已达上限' });
  });
});