const config = require('../../config');

const emailTemplate = {
  resetPassword: (username, verificationCode) => ({
    subject: 'OpsAway - 重置密码验证码',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h1>重置密码验证码</h1>
        <p>亲爱的 ${username}：</p>
        <p>我们收到了您的密码重置请求。您的验证码是：</p>
        <div style="background-color: #f4f4f4; padding: 10px; margin: 20px 0; font-size: 24px; text-align: center;">
          <strong>${verificationCode}</strong>
        </div>
        <p>此验证码将在10分钟内有效。</p>
        <p>如果这不是您本人的操作，请忽略此邮件。</p>
        <br>
        <p>OpsAway 团队</p>
      </div>
    `,
    text: `
      重置密码验证码

      亲爱的 ${username}：

      我们收到了您的密码重置请求。您的验证码是：${verificationCode}

      此验证码将在10分钟内有效。

      如果这不是您本人的操作，请忽略此邮件。

      OpsAway 团队
    `
  })
};

module.exports = emailTemplate;