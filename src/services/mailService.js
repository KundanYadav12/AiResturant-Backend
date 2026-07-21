const emailService = require('./email.service');

module.exports = {
  sendEmail: emailService.sendEmail,
  sendOtpEmail: emailService.sendOtpEmail
};
