import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly resend: Resend;
  private readonly logger = new Logger(MailService.name);
  private readonly fromAddress: string;
  private readonly appName = 'NearConnect';

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'));
    this.fromAddress = this.config.getOrThrow<string>('MAIL_FROM');
  }

  async sendVerificationEmail(
    to: string,
    fullName: string,
    token: string,
  ): Promise<void> {
    const verifyUrl = `${this.config.getOrThrow('FRONTEND_URL')}/auth/verify-email?token=${token}`;

    await this.send(to, `Verify your ${this.appName} email`, this.buildVerificationHtml(fullName, verifyUrl));
  }

  async sendPasswordResetEmail(
    to: string,
    fullName: string,
    token: string,
  ): Promise<void> {
    const resetUrl = `${this.config.getOrThrow('FRONTEND_URL')}/auth/reset-password?token=${token}`;

    await this.send(to, `Reset your ${this.appName} password`, this.buildPasswordResetHtml(fullName, resetUrl));
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async send(to: string, subject: string, html: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to,
      subject,
      html,
    });

    if (error) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`);
      throw new Error('Failed to send email. Please try again later.');
    }
  }

  private buildVerificationHtml(name: string, url: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family:Inter,sans-serif;background:#F8F9FF;margin:0;padding:32px;">
          <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:40px;">
            <h1 style="color:#4648D4;font-size:24px;margin-bottom:8px;">${this.appName}</h1>
            <h2 style="color:#0B1C30;font-size:20px;margin-bottom:16px;">Verify your email address</h2>
            <p style="color:#464554;font-size:16px;line-height:24px;">Hi ${name},</p>
            <p style="color:#464554;font-size:16px;line-height:24px;">
              Welcome to ${this.appName}! Please verify your email address to complete your registration.
              This link expires in <strong>24 hours</strong>.
            </p>
            <a href="${url}"
               style="display:inline-block;margin-top:24px;padding:14px 32px;background:#4648D4;color:#fff;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600;">
              Verify Email Address
            </a>
            <p style="color:#94A3B8;font-size:13px;margin-top:32px;">
              If you didn't create a ${this.appName} account, you can safely ignore this email.
            </p>
          </div>
        </body>
      </html>
    `;
  }

  private buildPasswordResetHtml(name: string, url: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family:Inter,sans-serif;background:#F8F9FF;margin:0;padding:32px;">
          <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:40px;">
            <h1 style="color:#4648D4;font-size:24px;margin-bottom:8px;">${this.appName}</h1>
            <h2 style="color:#0B1C30;font-size:20px;margin-bottom:16px;">Reset your password</h2>
            <p style="color:#464554;font-size:16px;line-height:24px;">Hi ${name},</p>
            <p style="color:#464554;font-size:16px;line-height:24px;">
              We received a request to reset your password. Click the button below to create a new one.
              This link expires in <strong>1 hour</strong>.
            </p>
            <a href="${url}"
               style="display:inline-block;margin-top:24px;padding:14px 32px;background:#4648D4;color:#fff;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600;">
              Reset Password
            </a>
            <p style="color:#464554;font-size:14px;margin-top:24px;">
              If you didn't request a password reset, please ignore this email or contact our support team
              if you believe your account has been compromised.
            </p>
            <p style="color:#94A3B8;font-size:13px;margin-top:16px;">
              This link is single-use and will expire after 1 hour.
            </p>
          </div>
        </body>
      </html>
    `;
  }
}
