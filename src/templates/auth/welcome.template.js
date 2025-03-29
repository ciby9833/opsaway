const config = require('../../config');

const emailTemplate = {
  welcome: (username) => ({
    subject: '欢迎加入 OpsAway',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h1>欢迎加入 OpsAway!</h1>
        <p>亲爱的 ${username}：</p>
        <p>感谢您注册 OpsAway！我们很高兴您能加入我们。</p>
        <p>您现在可以：</p>
        <ul>
          <li>创建和管理您的组织</li>
          <li>邀请团队成员</li>
          <li>管理订阅</li>
        </ul>
        <p>如果您有任何问题，请随时联系我们的支持团队。</p>
        <p>祝您使用愉快！</p>
        <br>
        <p>OpsAway 团队</p>
      </div>
    `,
    text: `
      欢迎加入 OpsAway!
      
      亲爱的 ${username}：
      
      感谢您注册 OpsAway！我们很高兴您能加入我们。
      
      您现在可以：
      - 创建和管理您的组织
      - 邀请团队成员
      - 管理订阅
      
      如果您有任何问题，请随时联系我们的支持团队。
      
      祝您使用愉快！
      
      OpsAway 团队
    `
  })
};

module.exports = emailTemplate;