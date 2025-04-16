const welcomeTemplate = require('./auth/welcome.template');
const resetPasswordTemplate = require('./auth/reset-password.template');
const accountDeactivationTemplate = require('./auth/deactivation.template');
const userDeletionTemplate = require('./admin/user-deletion.template');

module.exports = {
  auth: {
    welcome: welcomeTemplate.welcome,
    resetPassword: resetPasswordTemplate.resetPassword,
    accountDeactivation: accountDeactivationTemplate.accountDeactivation
  },
  admin: {
    userDeletion: userDeletionTemplate.userDeletionEmail
  },
  welcome: welcomeTemplate.welcome,
  resetPassword: resetPasswordTemplate.resetPassword,
  accountDeactivation: accountDeactivationTemplate.accountDeactivation
};