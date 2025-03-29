const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const UserModel = require('../models/user.model');
const googleConfig = require('./google');
const { sendEmail } = require('../config/email');
const emailTemplates = require('../templates/index');
const db = require('../config/database'); 

passport.use(new GoogleStrategy({
  clientID: googleConfig.clientId,
  clientSecret: googleConfig.clientSecret,
  callbackURL: googleConfig.redirectUri,
  scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const full_name = profile.displayName;
    const googleId = profile.id;
    let isNewUser = false;

    // 先检查活跃用户
    let user = await UserModel.findByEmail(email);
    if (!user) {
      // 检查是否存在已注销的 Google 用户
      const [inactiveUsers] = await db.execute(
        'SELECT * FROM users WHERE google_id = ? AND is_active = 0',
        [googleId]
      );
      if (inactiveUsers[0]) {
        // 激活已有用户
        user = inactiveUsers[0];
        await db.execute(
          'UPDATE users SET is_active = 1, email = ?, deleted_at = NULL, deleted_reason = NULL, deleted_email = NULL, updated_at = NOW() WHERE id = ?',
          [email, user.id]
        );
        user = await UserModel.findById(user.id); // 刷新用户信息
        console.log('Reactivated Google user:', { id: user.id, email });
      } else {
        // 新用户：注册
        const username = email.split('@')[0];
        user = await UserModel.create({
          username,
          email,
          password_hash: null,
          full_name,
          google_id: googleId
        });
        console.log('Google user registered:', { id: user.id, email, full_name });
        isNewUser = true;

        // 发送欢迎邮件
        try {
          await sendEmail({ 
            to: email, 
            ...emailTemplates.auth.welcome(full_name || username) 
          });
        } catch (emailError) {
          console.error('Failed to send welcome email for Google user:', emailError);
        }
      }
    } else if (user.google_id !== googleId) {
      await UserModel.updateGoogleId(user.id, googleId);
    }

    user.isNewUser = isNewUser;
    done(null, user);
  } catch (error) {
    console.error('Google strategy error:', error);
    done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await UserModel.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;