import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';
import { catchBlock } from '../common/util/CatchBlock';

@Injectable()
export class SmsService {
  private readonly client: twilio.Twilio;
  private readonly fromNumber: string;

  constructor(private readonly config: ConfigService) {
    this.client = twilio(
      this.config.getOrThrow<string>('TWILIO_ACCOUNT_SID'),
      this.config.getOrThrow<string>('TWILIO_AUTH_TOKEN'),
    );
    this.fromNumber = this.config.getOrThrow<string>('TWILIO_PHONE_NUMBER');
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    try {
      const body = `Your NearConnect verification code is: ${otp}. It expires in 10 minutes. Do not share this code with anyone.`;
      await this.client.messages.create({ body, from: this.fromNumber, to });
    } catch (error) {
      catchBlock(error);
    }
  }
}
