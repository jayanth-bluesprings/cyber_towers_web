const nodemailer = require('nodemailer');

const createTransporter = () => {
    return nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });
};

/**
 * Sends an email notification.
 * @param {string} subject - The subject of the email.
 * @param {string} html - The HTML content of the email.
 */
async function sendNotification(subject, html) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.EMAIL_PASS === 'YOUR_APP_PASSWORD_HERE') {
        console.warn('⚠️  Email credentials not configured. Skipping email notification.');
        return;
    }

    const transporter = createTransporter();

    try {
        const info = await transporter.sendMail({
            from: `"Vehicle Access System" <${process.env.EMAIL_USER}>`,
            to: process.env.ADMIN_EMAIL,
            subject: subject,
            html: html,
        });
        console.log(`✉️  Email sent successfully: ${info.messageId} | Subject: ${subject}`);
    } catch (error) {
        console.error('❌ Error sending email notification:', error);
    }
}

module.exports = { sendNotification };
