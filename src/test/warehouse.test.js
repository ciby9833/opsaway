// test/warehouse.test.js
const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database');
const redisService = require('../src/config/redis');
const UserModel = require('../src/models/user.model');
const LicenseModel = require('../src/models/license.model');
const MemberModel = require('../src/models/member.model');
const WarehouseModel = require('../src/models/warehouse.model');
const { generateTokens } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const { v4: uuidv4 } = require('uuid');
const config = require('../src/config');

// Mock 邮件发送功能
jest.mock('../src/config/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ messageId: 'mocked-message-id' }),
  transporter: { sendMail: jest.fn() }
}));

describe('Warehouse API Tests', () => {
  let subscriberId, subscriberToken, memberId, memberToken, warehouseId1, warehouseId2, memberWarehouseId, server;

  // 测试前初始化
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
      'INSERT INTO user_sessions (id, user_id, is_active, session_type) VALUES (?, ?, 1, "normal")',
      [subscriberSessionId, subscriberId]
    );
    await redisService.set(`session:${subscriberSessionId}`, { is_active: true }, 3600);
    const subscriberTokens = await generateTokens({ id: subscriberId, role: 'user' }, subscriberSessionId);
    subscriberToken = subscriberTokens.accessToken;

    // 创建成员
    const member = await UserModel.create({
      username: `member_${Date.now()}`,
      email: `member_${Date.now()}@example.com`,
      password_hash: await hashPassword('Member123')
    });
    memberId = member.id;
    const memberSessionId = uuidv4();
    await db.execute(
      'INSERT INTO user_sessions (id, user_id, is_active, session_type) VALUES (?, ?, 1, "normal")',
      [memberSessionId, memberId]
    );
    await redisService.set(`session:${memberSessionId}`, { is_active: true }, 3600);
    const memberTokens = await generateTokens({ id: memberId, role: 'user' }, memberSessionId);
    memberToken = memberTokens.accessToken;
  }, 10000);

  // 测试后清理
  afterAll(async () => {
    console.log('Starting cleanup...');
    try {
      await new Promise((resolve) => server.close(resolve));
      await redisService.quit();
      await db.end();
      console.log('Cleanup completed successfully.');
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }, 30000);

  // 每次测试前清理并初始化数据
  beforeEach(async () => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      
      // 清理数据
      await conn.execute('DELETE FROM warehouses WHERE 1=1');
      await conn.execute('DELETE FROM user_members WHERE user_id = ?', [subscriberId]);
      await conn.execute('DELETE FROM user_licenses WHERE user_id = ?', [subscriberId]);
      
      await conn.commit();

      // 清理缓存
      await Promise.all([
        redisService.del(`user:license:${subscriberId}`),
        redisService.del(`user:member:${memberId}`),
        redisService.del(`warehouses:${subscriberId}`),
        redisService.del(`warehouses:${memberId}`)
      ]);

      // 初始化许可和成员关系
      await LicenseModel.createLicense(subscriberId, 5, 'year');
      await MemberModel.addMember(subscriberId, member.email, member.username);

      // 创建测试仓库
      const warehouse1 = await WarehouseModel.create({
        name: '订阅者仓库1',
        province: '广东',
        city: '深圳',
        type: '成品仓',
        contact_phone: '123456789'
      }, { id: subscriberId });

      const warehouse2 = await WarehouseModel.create({
        name: '订阅者仓库2',
        province: '广东',
        city: '广州',
        type: '冷藏仓'
      }, { id: memberId, subscriberId: subscriberId });

      const memberWarehouse = await WarehouseModel.create({
        name: '成员仓库',
        province: '江苏',
        city: '南京',
        type: '中转仓'
      }, { id: memberId });

      warehouseId1 = warehouse1.id;
      warehouseId2 = warehouse2.id;
      memberWarehouseId = memberWarehouse.id;

    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  });

  describe('数据归属测试', () => {
    test('订阅者创建仓库 - 数据归属订阅者', async () => {
      const response = await request(app)
        .post(`${config.apiPrefix}/manage/warehouses`)
        .set('Authorization', `Bearer ${subscriberToken}`)
        .send({
          name: '新仓库',
          province: '浙江',
          city: '杭州',
          type: '原料仓'
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        user_id: subscriberId,
        created_by: subscriberId,
        name: '新仓库'
      });
    });

    test('成员创建仓库 - 数据归属订阅者', async () => {
      const response = await request(app)
        .post(`${config.apiPrefix}/manage/warehouses`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          name: '成员创建',
          province: '江苏',
          city: '南京',
          type: '中转仓'
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        user_id: subscriberId,
        created_by: memberId,
        name: '成员创建'
      });
    });

    test('订阅过期 - 成员数据归属自己', async () => {
      await db.execute('UPDATE user_licenses SET status = "expired" WHERE user_id = ?', [subscriberId]);
      await redisService.del(`user:license:${subscriberId}`);

      const response = await request(app)
        .post(`${config.apiPrefix}/manage/warehouses`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          name: '成员自己的仓库',
          province: '上海',
          city: '上海',
          type: '成品仓'
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        user_id: memberId,
        created_by: memberId,
        name: '成员自己的仓库'
      });
    });

    test('订阅者查看自己的仓库列表', async () => {
      const response = await request(app)
        .get(`${config.apiPrefix}/manage/warehouses`)
        .set('Authorization', `Bearer ${subscriberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.warehouses).toHaveLength(2);
      expect(response.body.data.warehouses.every(w => w.user_id === subscriberId)).toBe(true);
    });

    test('成员查看订阅者的仓库列表', async () => {
      const response = await request(app)
        .get(`${config.apiPrefix}/manage/warehouses`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.warehouses).toHaveLength(2);
      expect(response.body.data.warehouses.every(w => w.user_id === subscriberId)).toBe(true);
    });

    test('订阅过期 - 成员只能查看自己的仓库', async () => {
      await db.execute('UPDATE user_licenses SET status = "expired" WHERE user_id = ?', [subscriberId]);
      await redisService.del(`user:license:${subscriberId}`);

      const response = await request(app)
        .get(`${config.apiPrefix}/manage/warehouses`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.warehouses).toHaveLength(1);
      expect(response.body.data.warehouses[0].user_id).toBe(memberId);
    });
  });
});