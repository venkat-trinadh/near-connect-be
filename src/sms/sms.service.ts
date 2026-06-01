import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';

@Injectable()
export class SmsService {
  private readonly client: twilio.Twilio;
  private readonly logger = new Logger(SmsService.name);
  private readonly fromNumber: string;

  constructor(private readonly config: ConfigService) {
    this.client = twilio(
      this.config.getOrThrow<string>('TWILIO_ACCOUNT_SID'),
      this.config.getOrThrow<string>('TWILIO_AUTH_TOKEN'),
    );
    this.fromNumber = this.config.getOrThrow<string>('TWILIO_PHONE_NUMBER');
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    const body = `Your NearConnect verification code is: ${otp}. It expires in 10 minutes. Do not share this code with anyone.`;

    try {
      await this.client.messages.create({ body, from: this.fromNumber, to });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send OTP to ${to}: ${message}`);
      throw new Error('Failed to send verification code. Please try again.');
    }
  }
}
