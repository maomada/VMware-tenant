import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtphz.qiye.163.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

export async function sendVerificationEmail(email: string, token: string) {
  const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost'}/verify/${token}`;
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: 'VMware 租户管理系统 - 邮箱验证',
    html: `<p>请点击以下链接验证您的邮箱：</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>链接24小时内有效。</p>`
  });
}
