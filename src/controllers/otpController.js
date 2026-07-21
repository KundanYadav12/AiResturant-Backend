const db = require('../config/database');
const bcrypt = require('bcrypt');
const { sendOtpEmail, sendEmail } = require('../services/email.service');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');

// Helper to generate a 6-digit numeric OTP
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper to generate a random temporary password
function generateTempPassword() {
  return Math.random().toString(36).slice(-8) + Math.floor(10 + Math.random() * 90).toString();
}

/**
 * Normalizes OTP purpose/type strings to standard enum values.
 */
function normalizePurpose(type) {
  if (!type) return 'FORGOT_PASSWORD';
  const str = String(type).toUpperCase();
  if (str.includes('OWNER_REGISTRATION')) return 'OWNER_REGISTRATION';
  if (str.includes('MANAGER_REGISTRATION')) return 'MANAGER_REGISTRATION';
  if (str.includes('FORGOT_PASSWORD')) return 'FORGOT_PASSWORD';
  return str;
}

/**
 * Sends a registration or password reset OTP.
 * Request payload: { email, type / purpose, metadata }
 */
async function sendOtp(req, res) {
  const { email, type, purpose: reqPurpose, metadata } = req.body;
  const rawType = type || reqPurpose;

  if (!email || !rawType) {
    return res.status(400).json({ error: 'Email and purpose type are required' });
  }

  const purpose = normalizePurpose(rawType);
  const targetEmail = String(email).trim().toLowerCase();

  // Validate existing user status depending on purpose
  if (purpose === 'OWNER_REGISTRATION' || purpose === 'MANAGER_REGISTRATION') {
    try {
      const existing = await User.findByEmail(targetEmail);
      if (existing) {
        return res.status(400).json({ error: 'This email is already registered.' });
      }
    } catch (err) {
      console.error('[OTP] Error checking existing user:', err);
    }
  } else if (purpose === 'FORGOT_PASSWORD') {
    try {
      const existing = await User.findByEmail(targetEmail);
      if (!existing) {
        return res.status(404).json({ error: 'No account found with this email address.' });
      }
    } catch (err) {
      console.error('[OTP] Error checking user for forgot password:', err);
    }
  }

  try {
    // Check 30-second resend throttling on existing active OTP record
    const [existingRows] = await db.query(
      'SELECT created_at FROM otp_verifications WHERE email = ? AND otp_type = ? ORDER BY id DESC LIMIT 1',
      [targetEmail, purpose]
    );

    if (existingRows.length > 0) {
      const lastCreatedAt = new Date(existingRows[0].created_at).getTime();
      const elapsedSeconds = (Date.now() - lastCreatedAt) / 1000;
      if (elapsedSeconds < 30) {
        const remaining = Math.ceil(30 - elapsedSeconds);
        return res.status(429).json({
          error: `Please wait ${remaining} seconds before requesting a new OTP.`
        });
      }
    }

    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

    // Invalidate/delete previous OTPs for this email & purpose
    await db.query(
      'DELETE FROM otp_verifications WHERE email = ? AND otp_type = ?',
      [targetEmail, purpose]
    );

    // Save the new OTP verification record securely
    await db.query(
      'INSERT INTO otp_verifications (email, otp, otp_type, metadata, attempts, expires_at) VALUES (?, ?, ?, ?, 0, ?)',
      [targetEmail, hashedOtp, purpose, JSON.stringify(metadata || {}), expiresAt]
    );

    // Send professional HTML email directly via Gmail SMTP (never log raw OTP)
    await sendOtpEmail({
      to: targetEmail,
      otp,
      purpose
    });

    res.json({ message: 'Verification OTP code sent to your email.' });
  } catch (error) {
    console.error('[OTP] Error sending OTP:', error.message || error);
    res.status(500).json({ error: 'Failed to send verification OTP via email.' });
  }
}

/**
 * Resends a fresh OTP code enforcing 30-second cooldown.
 */
async function resendOtp(req, res) {
  return sendOtp(req, res);
}

/**
 * Verifies an OTP code and completes registration or password reset preparation.
 * Request payload: { email, otp, type / purpose }
 */
async function verifyOtp(req, res) {
  const { email, otp, type, purpose: reqPurpose } = req.body;
  const rawType = type || reqPurpose;

  if (!email || !otp || !rawType) {
    return res.status(400).json({ error: 'Email, OTP code, and purpose are required' });
  }

  const purpose = normalizePurpose(rawType);
  const targetEmail = String(email).trim().toLowerCase();

  try {
    // 1. Fetch OTP record
    const [rows] = await db.query(
      'SELECT * FROM otp_verifications WHERE email = ? AND otp_type = ?',
      [targetEmail, purpose]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No active verification request found for this email.' });
    }

    const otpRecord = rows[0];

    // 2. Check Expiry (5 minutes)
    if (new Date() > new Date(otpRecord.expires_at)) {
      await db.query('DELETE FROM otp_verifications WHERE id = ?', [otpRecord.id]);
      return res.status(400).json({ error: 'OTP Expired. Please request a new OTP code.' });
    }

    // 3. Check Max Attempts (5 attempts limit)
    if (otpRecord.attempts >= 5) {
      await db.query('DELETE FROM otp_verifications WHERE id = ?', [otpRecord.id]);
      return res.status(400).json({ error: 'OTP Invalid. Maximum failed attempts exceeded. Please request a new OTP.' });
    }

    // 4. Compare OTP hash
    const isMatch = await bcrypt.compare(String(otp).trim(), otpRecord.otp);
    if (!isMatch) {
      const newAttempts = otpRecord.attempts + 1;
      await db.query(
        'UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?',
        [otpRecord.id]
      );

      if (newAttempts >= 5) {
        await db.query('DELETE FROM otp_verifications WHERE id = ?', [otpRecord.id]);
        return res.status(400).json({ error: 'OTP Invalid. Maximum failed attempts exceeded. Please request a new OTP.' });
      }

      const remainingAttempts = 5 - newAttempts;
      return res.status(400).json({
        error: `Invalid OTP code. ${remainingAttempts} attempt(s) remaining.`
      });
    }

    // 5. Complete registration workflow if valid
    const metadata = JSON.parse(otpRecord.metadata || '{}');

    if (purpose === 'OWNER_REGISTRATION') {
      const { restaurantName, phone, address, ownerName, subscriptionPlan } = metadata;

      // Create Restaurant
      const restaurant = await Restaurant.create({
        name: restaurantName,
        phone: phone || '',
        email: targetEmail,
        address: address || '',
      });

      // Update plan if requested
      if (subscriptionPlan && subscriptionPlan !== 'FREE') {
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + 1);
        await Restaurant.update(restaurant.id, {
          subscription_plan: subscriptionPlan,
          status: 'ACTIVE',
          subscription_expires_at: expiryDate,
        });
      }

      // Generate temporary password
      const tempPassword = generateTempPassword();

      // Create OWNER user
      await User.create({
        restaurantId: restaurant.id,
        name: ownerName,
        email: targetEmail,
        password: tempPassword,
        role: 'OWNER',
      });

      // Send temporary password email to Owner
      await sendEmail({
        to: targetEmail,
        subject: `Welcome to AI Restaurant — Your Account Credentials`,
        html: `
          <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
            <h2>Welcome to AI Restaurant, ${ownerName}!</h2>
            <p>Your restaurant <strong>"${restaurantName}"</strong> and Owner account have been verified and created successfully.</p>
            <div style="background: #f4f4f5; padding: 15px; border-radius: 6px; margin: 15px 0;">
              <p><strong>Email:</strong> ${targetEmail}</p>
              <p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>
            </div>
            <p>Please log in and change your password immediately.</p>
          </div>
        `,
        text: `Hello ${ownerName},\nYour restaurant "${restaurantName}" is created!\nEmail: ${targetEmail}\nTemporary Password: ${tempPassword}`
      });

      // Delete OTP verification record after successful registration
      await db.query('DELETE FROM otp_verifications WHERE id = ?', [otpRecord.id]);

      return res.status(201).json({
        message: 'Owner account successfully verified and created.',
        email: targetEmail,
        tempPassword
      });
    }

    if (purpose === 'MANAGER_REGISTRATION') {
      const { name, restaurantId } = metadata;

      // Generate temporary password
      const tempPassword = generateTempPassword();

      // Create MANAGER user
      await User.create({
        restaurantId: restaurantId,
        name: name,
        email: targetEmail,
        password: tempPassword,
        role: 'MANAGER',
      });

      // Send credentials email to Manager
      await sendEmail({
        to: targetEmail,
        subject: `Your Manager Account Credentials — AI Restaurant`,
        html: `
          <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
            <h2>Hello ${name},</h2>
            <p>Your Manager account has been verified and created successfully!</p>
            <div style="background: #f4f4f5; padding: 15px; border-radius: 6px; margin: 15px 0;">
              <p><strong>Email:</strong> ${targetEmail}</p>
              <p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>
            </div>
            <p>Please log in and change your password immediately.</p>
          </div>
        `,
        text: `Hello ${name},\nYour Manager account is ready!\nEmail: ${targetEmail}\nTemporary Password: ${tempPassword}`
      });

      // Delete OTP verification record
      await db.query('DELETE FROM otp_verifications WHERE id = ?', [otpRecord.id]);

      return res.status(201).json({
        message: 'Manager account successfully verified and created.',
        email: targetEmail,
        tempPassword
      });
    }

    // For FORGOT_PASSWORD verification
    return res.json({ message: 'OTP verified successfully. You may now set your new password.' });
  } catch (error) {
    console.error('[OTP] Error verifying OTP:', error.message || error);
    res.status(500).json({ error: 'Failed to verify OTP code.' });
  }
}

/**
 * Handles Forgot Password OTP generation.
 * Request payload: { email, type / purpose }
 */
async function sendForgotPasswordOtp(req, res) {
  req.body.type = req.body.type || 'FORGOT_PASSWORD';
  return sendOtp(req, res);
}

/**
 * Validates the OTP and resets the user's password securely.
 * Request payload: { email, otp, newPassword, type / purpose }
 */
async function resetPasswordWithOtp(req, res) {
  const { email, otp, newPassword, type, purpose: reqPurpose } = req.body;
  const rawType = type || reqPurpose || 'FORGOT_PASSWORD';

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'Email, OTP, and new password are required' });
  }

  const purpose = normalizePurpose(rawType);
  const targetEmail = String(email).trim().toLowerCase();

  try {
    // 1. Fetch OTP record
    const [rows] = await db.query(
      'SELECT * FROM otp_verifications WHERE email = ? AND otp_type = ?',
      [targetEmail, purpose]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No password reset request found.' });
    }

    const otpRecord = rows[0];

    // 2. Check Expiry
    if (new Date() > new Date(otpRecord.expires_at)) {
      await db.query('DELETE FROM otp_verifications WHERE id = ?', [otpRecord.id]);
      return res.status(400).json({ error: 'OTP Expired. Please request a new password reset OTP.' });
    }

    // 3. Compare OTP
    const isMatch = await bcrypt.compare(String(otp).trim(), otpRecord.otp);
    if (!isMatch) {
      const newAttempts = otpRecord.attempts + 1;
      await db.query(
        'UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?',
        [otpRecord.id]
      );

      if (newAttempts >= 5) {
        await db.query('DELETE FROM otp_verifications WHERE id = ?', [otpRecord.id]);
        return res.status(400).json({ error: 'OTP Invalid. Maximum failed attempts exceeded. Please request a new OTP.' });
      }

      return res.status(400).json({ error: 'Invalid verification OTP.' });
    }

    // 4. Update Password in DB
    const user = await User.findByEmail(targetEmail);
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    await User.updatePassword(user.id, newPassword);

    // 5. Delete OTP record
    await db.query('DELETE FROM otp_verifications WHERE id = ?', [otpRecord.id]);

    res.json({ message: 'Password has been successfully updated. You may now log in.' });
  } catch (error) {
    console.error('[OTP] Reset password error:', error.message || error);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
}

module.exports = {
  sendOtp,
  resendOtp,
  verifyOtp,
  sendForgotPasswordOtp,
  resetPasswordWithOtp,
};
