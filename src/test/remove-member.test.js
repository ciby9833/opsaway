// tests/remove-member.test.js
const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database'); // 调整为正确路径
const redisService = require('../src/config/redis');
const UserModel = require('../src/models/user.model');
const LicenseModel = require('../src/models/license.model');
const MemberModel = require('../src/models/member.model');
const { generateTokens } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const { v4: uuidv4 } = require('uuid');

describe('Remove Member API Tests', () => {
  let subscriberId, subscriberToken, memberId, memberEmail, server;

  beforeAll(async () => {
    server = app.listen(0);

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

    const member = await UserModel.create({
      username: `testmember_${Date.now()}`,
      email: `testmember_${Date.now()}@example.com`,
      password_hash: await hashPassword('Test123456'),
    });
    memberId = member.id;
    memberEmail = member.email;
    await MemberModel.addMember(subscriberId, memberEmail);
  }, 60000);  // 增加到60秒

  afterAll(async () => {
    try {
      // 1. 先关闭服务器
      await new Promise((resolve) => {
        server.close(resolve);
      });
      
      // 2. 清理数据库数据
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute('DELETE FROM user_licenses WHERE user_id = ?', [subscriberId]);
        await conn.execute('DELETE FROM user_members WHERE user_id = ?', [subscriberId]);
        await conn.execute('DELETE FROM users WHERE id IN (?, ?)', [subscriberId, memberId]);
        await conn.execute('DELETE FROM user_sessions WHERE user_id IN (?, ?)', [subscriberId, memberId]);
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }

      // 3. 关闭 Redis 连接
      if (redisService.client.isOpen) {
        await redisService.client.disconnect();
      }

      // 4. 最后关闭数据库连接
      await db.end();

      console.log('Cleanup completed successfully');
    } catch (error) {
      console.error('Cleanup error:', error);
      throw error;  // 抛出错误以便 Jest 知道清理失败
    }
  }, 60000);  // 增加到60秒

  beforeEach(async () => {
    // 清理并重置数据
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // 先删除所有相关数据
      await conn.execute('DELETE FROM user_members WHERE user_id = ?', [subscriberId]);
      await conn.execute(
        'UPDATE user_licenses SET current_members = 0, status = "active" WHERE user_id = ?',
        [subscriberId]
      );
      await conn.commit();

      // 清理缓存
      await Promise.all([
        redisService.del(`user:license:${subscriberId}`),
        redisService.del(`user:member:${memberId}`),
        redisService.del(`ratelimit:127.0.0.1`),
        redisService.del(`ratelimit:::1`),
        redisService.del(`ratelimit:::ffff:127.0.0.1`)
      ]);

      // 重新添加成员
      await MemberModel.addMember(subscriberId, memberEmail);
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  });

  test('Should successfully remove a member', async () => {
    const response = await request(app)
      .delete(`/api/v1/manage/members/${memberId}`)
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'success', message: '成员已移除' });
  });

  test('Should fail when no token provided', async () => {
    const response = await request(app)
      .delete(`/api/v1/manage/members/${memberId}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '未提供访问令牌' });
  });

  test('Should fail with invalid token', async () => {
    const response = await request(app)
      .delete(`/api/v1/manage/members/${memberId}`)
      .set('Authorization', 'Bearer invalidtoken')
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '无效的访问令牌' });
  });

  test('Should fail when session is invalid', async () => {
    const invalidSessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active) VALUES (?, ?, 1)',
      [invalidSessionId, subscriberId]
    );
    await redisService.set(`session:${invalidSessionId}`, { is_active: false }, 3600);
    const invalidTokens = await generateTokens({ id: subscriberId, role: 'user' }, invalidSessionId);

    const response = await request(app)
      .delete(`/api/v1/manage/members/${memberId}`)
      .set('Authorization', `Bearer ${invalidTokens.accessToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '会话已失效，请重新登录' });
  });

  test('Should fail when license is expired', async () => {
    await db.execute(
      'UPDATE user_licenses SET status = "expired" WHERE user_id = ?',
      [subscriberId]
    );
    await redisService.del(`user:license:${subscriberId}`);

    const response = await request(app)
      .delete(`/api/v1/manage/members/${memberId}`)
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ status: 'error', message: '用户许可已过期，请续期' });
  });

  test('Should fail when member does not exist or already removed', async () => {
    await db.execute(
      'DELETE FROM user_members WHERE user_id = ? AND member_id = ?',
      [subscriberId, memberId]
    );

    const response = await request(app)
      .delete(`/api/v1/manage/members/${memberId}`)
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: 'error', message: '成员不存在或已移除' });
  });

  test('Should fail with invalid memberId format', async () => {
    const response = await request(app)
      .delete('/api/v1/manage/members/invalid-id')
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: 'error', message: '无效的成员ID' });
  });

  test('Should fail with server error if database fails', async () => {
    jest.spyOn(db, 'execute').mockRejectedValue(new Error('Database error'));

    const response = await request(app)
      .delete(`/api/v1/manage/members/${memberId}`)
      .set('Authorization', `Bearer ${subscriberToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ status: 'error', message: 'Internal Server Error' });

    jest.restoreAllMocks();
  });
});