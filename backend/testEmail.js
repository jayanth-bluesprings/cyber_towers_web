const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { sendNotification } = require('./utils/emailService');

async function test() {
    console.log('Using Email:', process.env.EMAIL_USER);
    console.log('Sending test email...');
    await sendNotification(
        'Testing Vehicle Dashboard Emails',
        '<h1>Hello!</h1><p>If you are seeing this, your email configuration is working perfectly.</p>'
    );
    console.log('Test complete. You can delete this file.');
}

test();
