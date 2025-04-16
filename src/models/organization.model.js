const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const redisService = require('../config/redis');

class OrganizationModel {
    // 缓存键前缀
    static CACHE_KEYS = {
        ORG: (orgId) => `org:${orgId}`,
        USER_ORGS: (userId) => `user:${userId}:organizations`,
        ORG_MEMBERS: (orgId) => `org:${orgId}:members`
    };

    // 创建组织
    static async create({
        name,
        owner_user_id,
        trial_end_date = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) // 默认15天试用期
    }) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const id = uuidv4();
            const [result] = await conn.execute(
                `INSERT INTO organizations (
                    id, name, owner_user_id, trial_end_date,
                    subscription_status, is_trial_used
                ) VALUES (?, ?, ?, ?, 'trial', 0)`,
                [id, name, owner_user_id, trial_end_date]
            );

            // 创建组织所有者关联
            await conn.execute(
                `INSERT INTO organization_users (
                    id, organization_id, user_id, role, status, joined_at
                ) VALUES (?, ?, ?, 'owner', 'active', NOW())`,
                [uuidv4(), id, owner_user_id]
            );

            await conn.commit();

            const org = await this.findById(id);
            return org;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    // 根据ID查找组织
    static async findById(id) {
        try {
            // 尝试从缓存获取
            const cached = await redisService.get(this.CACHE_KEYS.ORG(id));
            if (cached) return cached;

            const [rows] = await db.execute(
                'SELECT * FROM organizations WHERE id = ?',
                [id]
            );

            if (rows[0]) {
                // 设置缓存
                await redisService.set(this.CACHE_KEYS.ORG(id), rows[0], 3600);
            }

            return rows[0] || null;
        } catch (error) {
            throw error;
        }
    }

    // 查找用户所属的所有组织
    static async findByUserId(userId) {
        try {
            const cacheKey = this.CACHE_KEYS.USER_ORGS(userId);
            const cached = await redisService.get(cacheKey);
            if (cached) return cached;

            const [rows] = await db.execute(
                `SELECT o.*, ou.role as user_role, ou.status as user_status
                 FROM organizations o
                 JOIN organization_users ou ON o.id = ou.organization_id
                 WHERE ou.user_id = ? AND ou.status = 'active'
                 ORDER BY o.created_at DESC`,
                [userId]
            );

            await redisService.set(cacheKey, rows, 3600);
            return rows;
        } catch (error) {
            throw error;
        }
    }

    // 更新组织信息
    static async update(id, updateData) {
        try {
            const allowedFields = [
                'name',
                'subscription_start_date',
                'subscription_end_date',
                'subscription_max_users',
                'subscription_status',
                'is_trial_used',
                'trial_end_date',
                'is_active'
            ];

            const updates = [];
            const values = [];
            
            Object.keys(updateData).forEach(key => {
                if (allowedFields.includes(key)) {
                    updates.push(`${key} = ?`);
                    values.push(updateData[key]);
                }
            });

            if (updates.length === 0) return null;

            values.push(id);
            const [result] = await db.execute(
                `UPDATE organizations 
                 SET ${updates.join(', ')}, updated_at = NOW()
                 WHERE id = ?`,
                values
            );

            // 清除缓存
            await redisService.del(this.CACHE_KEYS.ORG(id));

            return result.affectedRows > 0;
        } catch (error) {
            throw error;
        }
    }

    // 获取组织成员列表
    static async getMembers(organizationId) {
        try {
            const cacheKey = this.CACHE_KEYS.ORG_MEMBERS(organizationId);
            const cached = await redisService.get(cacheKey);
            if (cached) return cached;

            const [rows] = await db.execute(
                `SELECT u.id, u.username, u.email, u.full_name,
                        ou.role, ou.status, ou.joined_at
                 FROM users u
                 JOIN organization_users ou ON u.id = ou.user_id
                 WHERE ou.organization_id = ? AND ou.status = 'active'
                 ORDER BY ou.joined_at DESC`,
                [organizationId]
            );

            await redisService.set(cacheKey, rows, 3600);
            return rows;
        } catch (error) {
            throw error;
        }
    }

    // 添加成员到组织
    static async addMember(organizationId, userId, role = 'member') {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            // 检查组织成员数量限制
            const org = await this.findById(organizationId);
            const currentMembers = await this.getMembers(organizationId);

            if (currentMembers.length >= org.subscription_max_users) {
                throw new Error('组织成员数量已达到上限');
            }

            // 添加成员
            await conn.execute(
                `INSERT INTO organization_users (
                    id, organization_id, user_id, role, status, joined_at
                ) VALUES (?, ?, ?, ?, 'active', NOW())`,
                [uuidv4(), organizationId, userId, role]
            );

            await conn.commit();

            // 清除相关缓存
            await redisService.del([
                this.CACHE_KEYS.ORG_MEMBERS(organizationId),
                this.CACHE_KEYS.USER_ORGS(userId)
            ]);

            return true;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    // 移除组织成员
    static async removeMember(organizationId, userId) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            // 检查是否为组织所有者
            const [ownerCheck] = await conn.execute(
                'SELECT owner_user_id FROM organizations WHERE id = ?',
                [organizationId]
            );

            if (ownerCheck[0].owner_user_id === userId) {
                throw new Error('不能移除组织所有者');
            }

            // 更新成员状态
            await conn.execute(
                `UPDATE organization_users 
                 SET status = 'removed', removed_at = NOW()
                 WHERE organization_id = ? AND user_id = ?`,
                [organizationId, userId]
            );

            await conn.commit();

            // 清除相关缓存
            await redisService.del([
                this.CACHE_KEYS.ORG_MEMBERS(organizationId),
                this.CACHE_KEYS.USER_ORGS(userId)
            ]);

            return true;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    // 检查用户是否是组织成员
    static async isMember(organizationId, userId) {
        try {
            const [rows] = await db.execute(
                `SELECT 1 FROM organization_users 
                 WHERE organization_id = ? AND user_id = ? AND status = 'active'`,
                [organizationId, userId]
            );
            return rows.length > 0;
        } catch (error) {
            throw error;
        }
    }

    // 获取用户在组织中的角色
    static async getUserRole(organizationId, userId) {
        try {
            const [rows] = await db.execute(
                `SELECT role FROM organization_users 
                 WHERE organization_id = ? AND user_id = ? AND status = 'active'`,
                [organizationId, userId]
            );
            return rows[0]?.role || null;
        } catch (error) {
            throw error;
        }
    }

    // 检查组织订阅状态
    static async checkSubscriptionStatus(organizationId) {
        try {
            const org = await this.findById(organizationId);
            if (!org) return false;

            const now = new Date();
            
            // 如果是试用期
            if (org.subscription_status === 'trial') {
                return now <= new Date(org.trial_end_date);
            }

            // 如果是正式订阅
            if (org.subscription_status === 'active') {
                return now <= new Date(org.subscription_end_date);
            }

            return false;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = OrganizationModel;
