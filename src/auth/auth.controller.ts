import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';
import { env } from 'src/config/env';
import { AUTH_COOKIE_NAME } from 'src/common/constants/auth.constants';
import { AUTH_THROTTLE } from 'src/common/constants/rate-limit.constants';
import { CurrentUser } from 'src/common/decorators/access.decorators';
import { AuthGuard, extractToken } from 'src/common/guards/auth.guard';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/types/authenticated-request.type';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignUpDto } from './dto/sign-up.dto';

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.ENVIRONMENT !== 'development',
  sameSite: 'lax',
  path: '/',
});

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: 'Public: sign in with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    res.cookie(AUTH_COOKIE_NAME, result.accessToken, {
      ...cookieOptions(),
      maxAge: result.expiresIn * 1000,
    });
    return result;
  }

  @Post('signup')
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: 'Public: create an account and sign in' })
  async signUp(
    @Body() dto: SignUpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.signUp(dto);
    res.cookie(AUTH_COOKIE_NAME, result.accessToken, {
      ...cookieOptions(),
      maxAge: result.expiresIn * 1000,
    });
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Public: sign out (revokes every session of the caller)',
  })
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(extractToken(req));
    res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
    return { success: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Signed-in user: get the current user' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }
}
