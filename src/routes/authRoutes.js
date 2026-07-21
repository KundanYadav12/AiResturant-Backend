const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');
const otpController = require('../controllers/otpController');

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.get('/me', authenticateToken, authController.getMe);

// Dedicated OTP Verification APIs (Prompt specified clean REST routes)
router.post('/send-otp', otpController.sendOtp);
router.post('/verify-otp', otpController.verifyOtp);
router.post('/resend-otp', otpController.resendOtp);
router.post('/forgot-password', otpController.sendForgotPasswordOtp);
router.post('/reset-password', otpController.resetPasswordWithOtp);

// Legacy Route Aliases (Ensuring 100% backwards compatibility)
router.post('/otp/send', otpController.sendOtp);
router.post('/otp/verify', otpController.verifyOtp);
router.post('/otp/resend', otpController.resendOtp);
router.post('/forgot-password/send-otp', otpController.sendForgotPasswordOtp);
router.post('/forgot-password/reset', otpController.resetPasswordWithOtp);

module.exports = router;
