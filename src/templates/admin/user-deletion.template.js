// src/templates/admin/user-deletion.template.js
const userDeletionEmail = (username, reason) => {
    return {
        subject: '您的账号已被管理员删除',
        text: `尊敬的 ${username}，\n\n您的账号已被管理员删除。\n${reason ? `删除原因：${reason}` : ''}\n\n如果您对此有任何疑问，请联系客服。\n\n祝好！`,
        html: `
            <p>尊敬的 ${username}，</p>
            <p>您的账号已被管理员删除。</p>
            ${reason ? `<p>删除原因：${reason}</p>` : ''}
            <p>如果您对此有任何疑问，请联系客服。</p>
            <p>祝好！</p>
        `
    };
};

module.exports = { userDeletionEmail };