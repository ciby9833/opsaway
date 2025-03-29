const welcomeTemplate = require('./auth/welcome.template');
const resetPasswordTemplate = require('./auth/reset-password.template');
const accountDeactivationTemplate = require('./auth/deactivation.template');

module.exports = {
  auth: {
    welcome: welcomeTemplate.welcome,
    resetPassword: resetPasswordTemplate.resetPassword,
    accountDeactivation: accountDeactivationTemplate.accountDeactivation
  },
  welcome: welcomeTemplate.welcome,
  resetPassword: resetPasswordTemplate.resetPassword,
  accountDeactivation: accountDeactivationTemplate.accountDeactivation
};