const db = require('../config/database'); // 引入数据库连接实例
const { v4: uuidv4 } = require('uuid'); // 引入uuid生成器

class UserLoginLogModel {
  static async create({
    user_id,
    session_id = null,
    ip_address,
    device_info,
    platform,
    success,
    failure_reason = null
  }) {
    const id = uuidv4();
    await db.execute(
      `INSERT INTO user_login_logs 
      (id, user_id, session_id, ip_address, device_info, platform, 
       success, failure_reason) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, user_id, session_id, ip_address, device_info, platform, 
       success, failure_reason]
    );
  }
}

module.exports = UserLoginLogModel;