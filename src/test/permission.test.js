// test/permission.test.js
const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database');
const redisService = require('../src/config/redis');
const UserModel = require('../src/models/user.model');
const LicenseModel = require('../src/models/license.model');
const MemberModel = require('../src/models/member.model');
const PermissionModel = require('../src/models/permission.model');
const { generateTokens } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const { v4: uuidv4 } = require('uuid');

// Mock 邮件发送功能
jest.mock('../src/config/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ messageId: 'mocked-message-id' }),
  transporter: { sendMail: jest.fn() }
}));

// 增加超时时间
jest.setTimeout(30000);

describe('Permission API Tests', () => {
  let subscriberId, subscriberToken;
  let member1, member2, memberToken1;
  let server;

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
    
    // 创建会话
    const subscriberSessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active, session_type) VALUES (?, ?, 1, "normal")',
      [subscriberSessionId, subscriberId]
    );
    await redisService.set(`session:${subscriberSessionId}`, { is_active: true }, 3600);
    const subscriberTokens = await generateTokens({ id: subscriberId, role: 'user' }, subscriberSessionId);
    subscriberToken = subscriberTokens.accessToken;

    // 创建成员1
    member1 = await UserModel.create({
      username: `member1_${Date.now()}`,
      email: `member1_${Date.now()}@example.com`,
      password_hash: await hashPassword('Member123')
    });

    // 创建成员2
    member2 = await UserModel.create({
      username: `member2_${Date.now()}`,
      email: `member2_${Date.now()}@example.com`,
      password_hash: await hashPassword('Member123')
    });

    // 创建有效许可
    await LicenseModel.createLicense(subscriberId, 5, 'year');

    // 添加成员到订阅者列表
    await MemberModel.addMember(subscriberId, member1.email);
    await MemberModel.addMember(subscriberId, member2.email);

    process.env.EMAIL_TEST_MODE = 'false';
    process.env.EMAIL_USER = 'test@example.com';
    process.env.EMAIL_SENDER_NAME = 'OpsAway Test';
  }, 10000);

  // 测试后清理
  afterAll(async () => {
    jest.useFakeTimers();
    try {
      console.log('Starting cleanup...');
      await new Promise((resolve) => server.close(resolve));
      if (redisService.client.isOpen) await redisService.client.disconnect();
      await db.end();
      console.log('Cleanup completed.');
      jest.runAllTimers();
    } catch (error) {
      console.error('Cleanup error:', error);
    } finally {
      jest.useRealTimers();
    }
  }, 30000);

  beforeEach(async () => {
    try {
      // 1. 清理数据（按顺序执行，避免死锁）
      await db.execute('DELETE FROM permissions WHERE user_id = ?', [subscriberId]);
      await db.execute('DELETE FROM user_members WHERE user_id = ?', [subscriberId]);
      await db.execute('DELETE FROM user_licenses WHERE user_id = ?', [subscriberId]);

      // 2. 清理缓存
      await Promise.all([
        redisService.del(`user:license:${subscriberId}`),
        redisService.del(`user:member:${member1.id}`),
        redisService.del(`user:member:${member2.id}`),
        redisService.del(`permissions:${member1.id}`),
        redisService.del(`permissions:${member2.id}`),
        redisService.del(`member:permissions:${subscriberId}:${member1.id}`),
        redisService.del(`member:permissions:${subscriberId}:${member2.id}`),
        redisService.del(`all_members_permissions:${subscriberId}`)
      ]);

      // 3. 创建许可证
      await LicenseModel.createLicense(subscriberId, 5, 'year');

      // 4. 添加成员（顺序执行，避免死锁）
      await MemberModel.addMember(subscriberId, member1.email);
      await MemberModel.addMember(subscriberId, member2.email);

      // 5. 等待成员状态更新
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 6. 验证成员状态
      const [memberStatus] = await db.execute(
        'SELECT COUNT(*) as count FROM user_members WHERE user_id = ? AND member_id IN (?, ?) AND status = "active"',
        [subscriberId, member1.id, member2.id]
      );

      if (!memberStatus[0] || memberStatus[0].count !== 2) {
        throw new Error('Member initialization failed');
      }

      // 7. 初始化权限（顺序执行，避免死锁）
      await PermissionModel.updateMemberPermissions(
        subscriberId,
        member1.id,
        ['warehouse.create']
      );
      
      // 为 member2 添加权限
      await PermissionModel.updateMemberPermissions(
        subscriberId,
        member2.id,
        ['warehouse.view']
      );

    } catch (error) {
      console.error('beforeEach error:', error);
      throw error;
    }
  });

  // 1. 更新权限（授予/撤销）测试
  describe('PUT /api/v1/manage/permissions - Update Permission', () => {
    test('成功授予权限', async () => {
      const response = await request(app)
        .put('/api/v1/manage/permissions')
        .set('Authorization', `Bearer ${subscriberToken}`)
        .send({
          memberId: member1.id,
          permission: 'warehouse.edit',
          action: 'grant'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('权限授予成功');
      
      const updatedPermissions = await PermissionModel.getMemberPermissions(subscriberId, member1.id);
      expect(updatedPermissions).toContainEqual(
        expect.objectContaining({ permission: 'warehouse.edit' })
      );
    });

    test('成功撤销权限', async () => {
      const response = await request(app)
        .put('/api/v1/manage/permissions')
        .set('Authorization', `Bearer ${subscriberToken}`)
        .send({
          memberId: member1.id,
          permission: 'warehouse.create',
          action: 'revoke'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('权限撤销成功');
    });

    test('无效权限失败', async () => {
      const response = await request(app)
        .put('/api/v1/manage/permissions')
        .set('Authorization', `Bearer ${subscriberToken}`)
        .send({
          memberId: member1.id,
          permission: 'invalid.permission',
          action: 'grant'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('无效的权限: invalid.permission');
    });

    test('成员不存在失败', async () => {
      const response = await request(app)
        .put('/api/v1/manage/permissions')
        .set('Authorization', `Bearer ${subscriberToken}`)
        .send({
          memberId: 'invalid-id',
          permission: 'warehouse.edit',
          action: 'grant'
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('成员不存在或状态非活跃');
    });

    test('订阅过期失败', async () => {
      await db.execute('UPDATE user_licenses SET status = "expired" WHERE user_id = ?', [subscriberId]);
      await redisService.del(`user:license:${subscriberId}`);
      const response = await request(app)
        .put('/api/v1/manage/permissions')
        .set('Authorization', `Bearer ${subscriberToken}`)
        .send({
          memberId: member1.id,
          permission: 'warehouse.edit',
          action: 'grant'
        });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('订阅者许可无效或已过期');
    });
  });

  // 2. 批量更新权限测试
  describe('PUT /api/v1/manage/permissions/batch - Batch Update Permissions', () => {
    test('成功批量更新权限', async () => {
      const response = await request(app)
        .put('/api/v1/manage/permissions/batch')
        .set('Authorization', `Bearer ${subscriberToken}`)
        .send({
          memberId: member1.id,
          permissions: ['warehouse.edit', 'warehouse.view']
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('权限批量更新成功');
    });

    test('清空权限成功', async () => {
      const response = await request(app)
        .put('/api/v1/manage/permissions/batch')
        .set('Authorization', `Bearer ${subscriberToken}`)
        .send({
          memberId: member1.id,
          permissions: []
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('权限批量更新成功');
    });

    test('无效权限列表失败', async () => {
      const response = await request(app)
        .put('/api/v1/manage/permissions/batch')
        .set('Authorization', `Bearer ${subscriberToken}`)
        .send({
          memberId: member1.id,
          permissions: ['warehouse.create', 'invalid.permission']
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('无效的权限: invalid.permission');
    });

    test('缺少参数失败', async () => {
      const response = await request(app)
        .put('/api/v1/manage/permissions/batch')
        .set('Authorization', `Bearer ${subscriberToken}`)
        .send({ memberId: member1.id });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('请提供成员ID和有效的权限列表');
    });
  });

  // 3. 获取成员权限测试
  describe('GET /api/v1/manage/permissions/member/:memberId - Get Member Permissions', () => {
    test('成功获取成员权限', async () => {
      const response = await request(app)
        .get(`/api/v1/manage/permissions/member/${member1.id}`)
        .set('Authorization', `Bearer ${subscriberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.member_id).toBe(member1.id);
      expect(response.body.data.permissions).toContainEqual(
        expect.objectContaining({ permission: 'warehouse.create' })
      );
    });

    test('成员无权限返回空数组', async () => {
      await PermissionModel.updateMemberPermissions(subscriberId, member1.id, []);
      await new Promise(resolve => setTimeout(resolve, 100));  // 等待更新完成
      
      const response = await request(app)
        .get(`/api/v1/manage/permissions/member/${member1.id}`)
        .set('Authorization', `Bearer ${subscriberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.permissions).toEqual([]);
    });

    test('成员不存在失败', async () => {
      const response = await request(app)
        .get('/api/v1/manage/permissions/member/invalid-id')
        .set('Authorization', `Bearer ${subscriberToken}`);

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('成员不存在');
    });
  });

  // 4. 获取所有成员权限测试
  describe('GET /api/v1/manage/permissions/members - Get All Members Permissions', () => {
    test('成功获取所有成员权限', async () => {
      const response = await request(app)
        .get('/api/v1/manage/permissions/members')
        .set('Authorization', `Bearer ${subscriberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.members.length).toBe(2);
      expect(response.body.data.members).toContainEqual(
        expect.objectContaining({
          member_id: member1.id,
          permissions: expect.arrayContaining([
            expect.objectContaining({ permission: 'warehouse.create' })
          ])
        })
      );
      expect(response.body.data.members).toContainEqual(
        expect.objectContaining({
          member_id: member2.id,
          permissions: expect.arrayContaining([
            expect.objectContaining({ permission: 'warehouse.view' })
          ])
        })
      );
    });

    test('无成员返回空数组', async () => {
      // 1. 删除成员及相关数据
      await Promise.all([
        db.execute('DELETE FROM permissions WHERE user_id = ?', [subscriberId]),
        db.execute('DELETE FROM user_members WHERE user_id = ?', [subscriberId])
      ]);

      // 2. 清理缓存
      await Promise.all([
        redisService.del(`user:member:${member1.id}`),
        redisService.del(`user:member:${member2.id}`),
        redisService.del(`permissions:${member1.id}`),
        redisService.del(`permissions:${member2.id}`),
        redisService.del(`member:permissions:${subscriberId}:${member1.id}`),
        redisService.del(`member:permissions:${subscriberId}:${member2.id}`),
        redisService.del(`all_members_permissions:${subscriberId}`)
      ]);

      // 3. 等待数据库操作完成
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const response = await request(app)
        .get('/api/v1/manage/permissions/members')
        .set('Authorization', `Bearer ${subscriberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.members).toEqual([]);
    });

    test('无令牌失败', async () => {
      const response = await request(app)
        .get('/api/v1/manage/permissions/members');

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('未提供访问令牌');
    });

    test('许可过期失败', async () => {
      await db.execute('UPDATE user_licenses SET status = "expired" WHERE user_id = ?', [subscriberId]);
      await redisService.del(`user:license:${subscriberId}`);
      await new Promise(resolve => setTimeout(resolve, 100));  // 等待更新完成
      
      const response = await request(app)
        .get('/api/v1/manage/permissions/members')
        .set('Authorization', `Bearer ${subscriberToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('订阅者许可无效或已过期');
    });
  });
});