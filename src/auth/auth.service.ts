import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { RegisterDto } from './dto/register.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { catchBlock } from '../common/util/CatchBlock';

// ─── Constants ────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;
const EMAIL_TOKEN_TTL_HOURS = 24;
const RESET_TOKEN_TTL_MINUTES = 60;
const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 3;
const MAX_OTP_RESENDS = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SafeUser {
  id: number;
  email: string;
  fullName: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  phoneNumber: string | null;
  countryCode: string | null;
  googleId: string | null;
  createdAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) { }

  // ─── Registration ─────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    try {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });

      if (existing) {
        throw new ConflictException('An account with this email already exists');
      }

      const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

      const user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          fullName: dto.fullName.trim(),
          password: hashedPassword,
        },
      });

      // Fire-and-forget — don't block registration if email fails
      this.issueEmailVerificationToken(user.id, user.email, user.fullName).catch(
        () => void 0,
      );

      const accessToken = this.signToken(user.id, user.email);
      const data = { accessToken, user: this.toSafeUser(user) }
      const result = { message: 'Account created. Please verify your email to continue.', data };
      return result;
    } catch (error) {
      catchBlock(error)
    }
  }

  // ─── Email verification ───────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<void> {
    try {
      const record = await this.prisma.emailVerificationToken.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!record || record.isUsed || record.expiresAt < new Date()) {
        throw new BadRequestException('Verification link is invalid or has expired');
      }

      await this.prisma.$transaction([
        this.prisma.emailVerificationToken.update({
          where: { id: record.id },
          data: { isUsed: true },
        }),
        this.prisma.user.update({
          where: { id: record.userId },
          data: { isEmailVerified: true },
        }),
      ]);
    } catch (error) {
      catchBlock(error);
    }
  }

  async resendVerificationEmail(email: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      // Silently succeed even when the email doesn't exist — prevents user enumeration
      if (!user || user.isEmailVerified) return;

      await this.issueEmailVerificationToken(user.id, user.email, user.fullName);
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async validateLocalUser(email: string, password: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!user || !user.password) return null;

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return null;

      return this.toSafeUser(user);
    } catch (error) {
      catchBlock(error);
    }
  }

  login(user: SafeUser){
    try {
      return { accessToken: this.signToken(user.id, user.email), user };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Google OAuth ─────────────────────────────────────────────────────────

  async validateGoogleUser(profile: {
    googleId: string;
    email: string;
    fullName: string;
  }) {
    try {
      const { googleId, email, fullName } = profile;

      // Try to find by googleId first, then fall back to email
      let user = await this.prisma.user.findFirst({
        where: { OR: [{ googleId }, { email: email.toLowerCase() }] },
      });

      if (user) {
        // Link Google ID if the account was previously created with email/password
        if (!user.googleId) {
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: { googleId, isEmailVerified: true },
          });
        }
      } else {
        // Create a new Google-only account — email is pre-verified by Google
        user = await this.prisma.user.create({
          data: {
            email: email.toLowerCase(),
            fullName,
            googleId,
            isEmailVerified: true,
          },
        });
      }

      return this.toSafeUser(user);
    } catch (error) {
      catchBlock(error);
    }
  }

  googleLogin(user: SafeUser){
    try {
      return this.login(user);
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Phone OTP ────────────────────────────────────────────────────────────

  async sendOtp(userId: number, dto: SendOtpDto): Promise<void> {
    try {
      const fullPhone = `${dto.countryCode}${dto.phoneNumber}`;

      // Check if this phone is already verified by another account
      const phoneOwner = await this.prisma.user.findFirst({
        where: {
          phoneNumber: dto.phoneNumber,
          countryCode: dto.countryCode,
          isPhoneVerified: true,
          NOT: { id: userId },
        },
      });

      if (phoneOwner) {
        throw new ConflictException('This phone number is already associated with another account');
      }

      // Check resend rate limit using the most recent non-expired OTP for this user
      const latestOtp = await this.prisma.otpCode.findFirst({
        where: { userId, isUsed: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });

      if (latestOtp && latestOtp.resendCount >= MAX_OTP_RESENDS) {
        throw new BadRequestException(
          `You have reached the maximum resend limit. Please wait ${OTP_TTL_MINUTES} minutes and try again.`,
        );
      }

      if (latestOtp) {
        // Increment resend counter instead of creating a new OTP record
        await this.prisma.otpCode.update({
          where: { id: latestOtp.id },
          data: { resendCount: { increment: 1 } },
        });
        await this.sms.sendOtp(fullPhone, latestOtp.code);
        return;
      }

      // Generate a new OTP
      const code = this.generateOtp();
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

      await this.prisma.otpCode.create({
        data: { userId, phone: fullPhone, code, expiresAt },
      });

      // Save phone on user record (not yet verified)
      await this.prisma.user.update({
        where: { id: userId },
        data: { phoneNumber: dto.phoneNumber, countryCode: dto.countryCode },
      });

      await this.sms.sendOtp(fullPhone, code);
    } catch (error) {
      catchBlock(error);
    }
  }

  async verifyOtp(userId: number, code: string): Promise<void> {
    try {
      const otp = await this.prisma.otpCode.findFirst({
        where: { userId, isUsed: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });

      if (!otp) {
        throw new BadRequestException('No active verification code found. Please request a new one.');
      }

      if (otp.attempts >= MAX_OTP_ATTEMPTS) {
        throw new BadRequestException(
          'Too many incorrect attempts. Please request a new code.',
        );
      }

      if (otp.code !== code) {
        await this.prisma.otpCode.update({
          where: { id: otp.id },
          data: { attempts: { increment: 1 } },
        });

        const remaining = MAX_OTP_ATTEMPTS - (otp.attempts + 1);
        throw new BadRequestException(
          remaining > 0
            ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
            : 'Too many incorrect attempts. Please request a new code.',
        );
      }

      // Mark OTP as used and mark phone as verified in one transaction
      await this.prisma.$transaction([
        this.prisma.otpCode.update({
          where: { id: otp.id },
          data: { isUsed: true },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { isPhoneVerified: true },
        }),
      ]);
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Forgot / Reset password ──────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!user) {
        // Don't reveal whether the email exists
        return;
      }

      if (user.googleId) {
        throw new BadRequestException(
          'This account uses Google Sign-In. Please continue with Google.'
        );
      }

      // Invalidate previous tokens before issuing a new one
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, isUsed: false },
        data: { isUsed: true },
      });

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      });

      await this.mail.sendPasswordResetEmail(user.email, user.fullName, token);
    } catch (error) {
      catchBlock(error);
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    try {
      const record = await this.prisma.passwordResetToken.findUnique({
        where: { token: dto.token },
        include: { user: true },
      });

      if (!record || record.isUsed || record.expiresAt < new Date()) {
        throw new BadRequestException('Reset link is invalid or has expired');
      }

      const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

      await this.prisma.$transaction([
        this.prisma.passwordResetToken.update({
          where: { id: record.id },
          data: { isUsed: true },
        }),
        this.prisma.user.update({
          where: { id: record.userId },
          data: { password: hashedPassword },
        }),
      ]);
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  async getMe(userId: number)  {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) throw new NotFoundException('User not found');
      return this.toSafeUser(user);
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private signToken(userId: number, email: string): string {
    const payload = { sub: userId, email };
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN', '365d');
    // Cast needed: @nestjs/jwt expects StringValue from 'ms', but ConfigService returns string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.jwt.sign(payload, { expiresIn: expiresIn as any });
  }

  private async issueEmailVerificationToken(
    userId: number,
    email: string,
    fullName: string,
  ): Promise<void> {
    // Invalidate any existing unused tokens
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, isUsed: false },
      data: { isUsed: true },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + EMAIL_TOKEN_TTL_HOURS * 60 * 60 * 1000,
    );

    await this.prisma.emailVerificationToken.create({
      data: { userId, token, expiresAt },
    });

    await this.mail.sendVerificationEmail(email, fullName, token);
  }

  private generateOtp(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  private toSafeUser(user: {
    id: number;
    email: string;
    fullName: string;
    isEmailVerified: boolean;
    isPhoneVerified: boolean;
    phoneNumber: string | null;
    countryCode: string | null;
    googleId: string | null;
    createdAt: Date;
  }): SafeUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      phoneNumber: user.phoneNumber,
      countryCode: user.countryCode,
      googleId: user.googleId,
      createdAt: user.createdAt,
    };
  }
}
