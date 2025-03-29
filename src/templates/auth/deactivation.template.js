const config = require('../../config');

const emailTemplate = {
  accountDeactivation: (username) => ({
  subject: 'OpsAway - 账号注销确认',
  html: `
    <h2>账号注销确认</h2>
    <p>尊敬的 ${username}：</p>
    <p>您的账号已成功注销。如果这不是您本人的操作，请立即联系我们的客服团队。</p>
    <p>注意：您可以使用相同的邮箱重新注册新账号。</p>
    <p>感谢您曾经使用我们的服务。</p>
  `,
  text: `
    账号注销确认
    
    尊敬的 ${username}：
    
    您的账号已成功注销。如果这不是您本人的操作，请立即联系我们的客服团队。
    
    注意：您可以使用相同的邮箱重新注册新账号。
    
    感谢您曾经使用我们的服务。
  `
  })
};


module.exports = emailTemplate;