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

describe('Member Leave API Tests', () => {
    let subscriberId = null; // 初始化为 null
    let server; // 使用 let 而非 const

    beforeAll(async () => {
        server = app.listen(0); // 动态端口
        const subscriber = await UserModel.create({
          username: `testsubscriber_${Date.now()}`,
          email: `testsubscriber_${Date.now()}@example.com`,
          password_hash: await hashPassword('Test123456'),
        });
        subscriberId = subscriber.id;
    
        await LicenseModel.createLicense(subscriberId, 5, 'month');
        const license = await LicenseModel.checkLicenseStatus(subscriberId);
        console.log('License after creation:', license);
        const cachedLicenseStr = await redisService.get(`user:license:${subscriberId}`);
        console.log('Cached license after creation:', cachedLicenseStr ? JSON.parse(cachedLicenseStr) : null);
      });

      afterAll(async () => {
        try {
          if (subscriberId) { // 检查 subscriberId 是否存在
            await Promise.all([
              db.execute('DELETE FROM user_licenses WHERE user_id = ?', [subscriberId]),
              db.execute('DELETE FROM user_members WHERE user_id = ?', [subscriberId]),
              db.execute('DELETE FROM users WHERE id = ?', [subscriberId]),
              db.execute('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE "test%")'),
              db.execute('DELETE FROM users WHERE email LIKE "test%"'),
            ]);
          }
          await db.end();
          await redisService.quit();
          if (server && server.listening) {
            await new Promise((resolve) => server.close(resolve));
          }
          // 添加延迟确保 Redis 连接关闭
        await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          console.error('Cleanup error:', error);
        }
      });

  async function createMemberAndToken() {
    const member = await UserModel.create({
      username: `testmember_${Date.now()}`,
      email: `testmember_${Date.now()}@example.com`,
      password_hash: await hashPassword('Test123456'),
    });
    await MemberModel.addMember(subscriberId, member.email);
    const sessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active) VALUES (?, ?, 1)',
      [sessionId, member.id]
    );
    await redisService.set(`session:${sessionId}`, { is_active: true }, 3600);
    const tokens = await generateTokens({ id: member.id, role: 'user' }, sessionId);
    return { memberId: member.id, token: tokens.accessToken };
  }

  test('Should successfully leave subscription', async () => {
    const { memberId, token } = await createMemberAndToken();
    const response = await request(app)
      .post('/api/v1/manage/members/leave')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'success', message: '已成功脱离订阅列表' });

    const [members] = await db.execute(
      'SELECT * FROM user_members WHERE member_id = ? AND status = "active"',
      [memberId]
    );
    expect(members.length).toBe(0);
  });

  test('Should fail when no token provided', async () => {
    const response = await request(app)
      .post('/api/v1/manage/members/leave');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '未提供访问令牌' });
  });

  test('Should fail with invalid token', async () => {
    const response = await request(app)
      .post('/api/v1/manage/members/leave')
      .set('Authorization', 'Bearer invalidtoken');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 'error', message: '无效的访问令牌' });
  });

  test('Should fail when user is not in any subscription', async () => {
    const loneUser = await UserModel.create({
      username: `loneuser_${Date.now()}`,
      email: `loneuser_${Date.now()}@example.com`,
      password_hash: await hashPassword('Test123456'),
    });
    const sessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active) VALUES (?, ?, 1)',
      [sessionId, loneUser.id]
    );
    await redisService.set(`session:${sessionId}`, { is_active: true }, 3600);
    const tokens = await generateTokens({ id: loneUser.id, role: 'user' }, sessionId);
    const loneUserToken = tokens.accessToken;

    const response = await request(app)
      .post('/api/v1/manage/members/leave')
      .set('Authorization', `Bearer ${loneUserToken}`);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: 'error', message: '成员不在任何订阅列表中' });
  });

  test('Should update cache after leaving subscription', async () => {
    const { memberId, token } = await createMemberAndToken();
    const response = await request(app)
      .post('/api/v1/manage/members/leave')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'success', message: '已成功脱离订阅列表' });

    const cachedLicenseStr = await redisService.get(`user:license:${subscriberId}`);
    const cachedLicense = cachedLicenseStr ? JSON.parse(cachedLicenseStr) : null;
    expect(cachedLicense).not.toBeNull();
    expect(cachedLicense.current_members).toBeLessThanOrEqual(4);
  });

  test('Should handle concurrent leave requests correctly', async () => {
    const { memberId, token } = await createMemberAndToken();
    const leavePromises = [
      request(app).post('/api/v1/manage/members/leave').set('Authorization', `Bearer ${token}`),
      request(app).post('/api/v1/manage/members/leave').set('Authorization', `Bearer ${token}`)
    ];
    const responses = await Promise.all(leavePromises);

    expect(responses[0].status).toBe(200);
    expect(responses[0].body).toEqual({ status: 'success', message: '已成功脱离订阅列表' });
    expect(responses[1].status).toBe(400);
    expect(responses[1].body).toEqual({ status: 'error', message: '成员不在任何订阅列表中' });
  });
});