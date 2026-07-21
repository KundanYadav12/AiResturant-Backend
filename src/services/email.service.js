const nodemailer = require('nodemailer');
require('dotenv').config();

function getTransporter() {
  const host = process.env.MAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.MAIL_PORT || process.env.SMTP_PORT || '587', 10);
  const user = process.env.MAIL_USER || process.env.SMTP_USER || '';
  const pass = process.env.MAIL_PASS || process.env.SMTP_PASS || '';

  if (!user || !pass) {
    throw new Error('Gmail SMTP credentials (MAIL_USER / MAIL_PASS) are missing in .env.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

function buildHtmlTemplate({ title, badgeText, mainMessage, otpCode, validityMinutes = 5 }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#334155;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 30px; text-align: center;">
              <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:700; letter-spacing:1px;">AI Restaurant</h1>
              <p style="margin: 6px 0 0 0; color: #94a3b8; font-size:14px;">Next-Gen Autonomous Dining System</p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 40px 30px; text-align: center;">
              <span style="display:inline-block; padding: 6px 16px; background-color:#e0f2fe; color:#0284c7; font-size:12px; font-weight:700; border-radius:20px; text-transform:uppercase; letter-spacing:1px; margin-bottom: 20px;">
                ${badgeText}
              </span>

              <h2 style="margin:0 0 12px 0; color:#0f172a; font-size:20px; font-weight:600;">${title}</h2>
              <p style="margin:0 0 28px 0; color:#64748b; font-size:15px; line-height:1.5;">${mainMessage}</p>

              <!-- OTP Box -->
              <div style="background-color:#f8fafc; border: 2px dashed #cbd5e1; border-radius:10px; padding: 20px; margin: 0 auto 28px auto; max-width:320px;">
                <span style="font-size:36px; font-weight:800; color:#2563eb; letter-spacing:8px; font-family: monospace;">
                  ${otpCode}
                </span>
              </div>

              <p style="margin:0; color:#94a3b8; font-size:13px;">
                ⏱ This OTP is valid for <strong>${validityMinutes} minutes</strong>.
              </p>
            </td>
          </tr>

          <!-- Security Notice -->
          <tr>
            <td style="padding: 0 30px 30px 30px; text-align: center;">
              <div style="background-color:#fffbeb; border-radius:8px; padding:14px; text-align:left; border-left:4px solid #f59e0b;">
                <p style="margin:0; color:#b45309; font-size:12px; line-height:1.4;">
                  🛡 <strong>Security Reminder:</strong> Do not share this code with anyone. AI Restaurant support staff will never ask for your verification code. If you did not request this, please ignore this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc; padding:20px 30px; text-align:center; border-top:1px solid #e2e8f0;">
              <p style="margin:0; color:#94a3b8; font-size:12px;">© AI Restaurant. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends a general email.
 */
async function sendEmail({ to, subject, html, text }) {
  const transporter = getTransporter();
  const fromAddress = process.env.MAIL_FROM || `"AI Restaurant" <${process.env.MAIL_USER || process.env.SMTP_USER}>`;

  const info = await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    text: text || '',
    html: html || text
  });

  return info;
}

/**
 * Sends a branded OTP Email based on purpose.
 */
async function sendOtpEmail({ to, otp, purpose }) {
  let subject = 'AI Restaurant Verification Code';
  let title = 'Email Verification';
  let badgeText = 'Account Verification';
  let mainMessage = 'Please use the verification code below to complete your registration request.';

  if (purpose === 'FORGOT_PASSWORD' || purpose === 'OWNER_FORGOT_PASSWORD' || purpose === 'MANAGER_FORGOT_PASSWORD') {
    subject = 'Reset Your AI Restaurant Password';
    title = 'Password Reset Verification';
    badgeText = 'Security Verification';
    mainMessage = 'We received a request to reset your AI Restaurant account password. Enter the verification code below to proceed.';
  } else if (purpose === 'OWNER_REGISTRATION') {
    subject = 'AI Restaurant Verification Code';
    title = 'Owner Account Verification';
    badgeText = 'Restaurant Onboarding';
    mainMessage = 'Your new restaurant registration is almost complete. Please enter the OTP code below to verify your email.';
  } else if (purpose === 'MANAGER_REGISTRATION') {
    subject = 'AI Restaurant Verification Code';
    title = 'Manager Account Verification';
    badgeText = 'Staff Verification';
    mainMessage = 'You have been invited as a Restaurant Manager. Enter the OTP code below to verify your email and activate your account.';
  }

  const html = buildHtmlTemplate({
    title,
    badgeText,
    mainMessage,
    otpCode: otp,
    validityMinutes: 5
  });

  const text = `${title}\nYour verification code is: ${otp}\nThis code is valid for 5 minutes. If you did not request this, please ignore this email.`;

  return await sendEmail({ to, subject, html, text });
}

module.exports = {
  sendEmail,
  sendOtpEmail
};
