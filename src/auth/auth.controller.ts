import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import type { SafeUser } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto'; // used as Swagger body — keep in scope
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';

// LoginDto is referenced in Swagger decorators; suppress unused-import lint:
void (LoginDto as unknown);

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  // ─── Registration ─────────────────────────────────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a new account with email & password' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  // ─── Email Verification ───────────────────────────────────────────────────

  @Get('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address using the token from the email link' })
  async verifyEmail(@Query('token') token: string) {
    await this.authService.verifyEmail(token);
    return { message: 'Email verified successfully', data: null };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resend email verification link' })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.authService.resendVerificationEmail(dto.email);
    return {
      message:
        'If an unverified account exists for this email, a new verification link has been sent.',
      data: null,
    };
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() _dto: LoginDto, @CurrentUser() user: object) {
    const result = this.authService.login(user as SafeUser);
    return { message: 'Logged in successfully', data: result };
  }

  // ─── Google OAuth ─────────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  googleAuth() {
    // Handled by GoogleAuthGuard — redirects to Google
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback — redirects to frontend with token' })
  googleCallback(@CurrentUser() user: object, @Res() res: Response) {
    const loginResult = this.authService.googleLogin(user as SafeUser);
    const accessToken = loginResult?.accessToken;
    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
    return res.redirect(`${frontendUrl}/auth/callback?token=${accessToken}`);
  }

  // ─── Phone OTP ────────────────────────────────────────────────────────────

  @Post('send-otp')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send OTP to a phone number for verification' })
  async sendOtp(@CurrentUser() user: object, @Body() dto: SendOtpDto) {
    const { id } = user as SafeUser;
    await this.authService.sendOtp(id, dto);
    return {
      message: `Verification code sent to ${dto.countryCode}${dto.phoneNumber}`,
      data: null,
    };
  }

  @Post('verify-otp')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify the OTP sent to the phone number' })
  async verifyOtp(@CurrentUser() user: object, @Body() dto: VerifyOtpDto) {
    const { id } = user as SafeUser;
    await this.authService.verifyOtp(id, dto.code);
    return { message: 'Phone number verified successfully', data: null };
  }

  // ─── Forgot / Reset password ──────────────────────────────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return {
      message:
        'If an account exists for this email, a password reset link has been sent.',
      data: null,
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset password using the token from the email link' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return {
      message: 'Password reset successfully. You can now log in.',
      data: null,
    };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout — client should discard the token from localStorage',
  })
  logout(@Req() _req: unknown) {
    return { message: 'Logged out successfully', data: null };
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user profile' })
  async me(@CurrentUser() user: object) {
    const { id } = user as SafeUser;
    const profile = await this.authService.getMe(id);
    return { message: 'Profile fetched successfully', data: profile };
  }
}
