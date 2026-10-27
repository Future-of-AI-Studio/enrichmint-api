import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from 'src/config/env';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { ContributorGuard } from 'src/common/guards/contributor.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: env.JWT_SECRET,
      signOptions: {
        expiresIn: env.JWT_TTL_SECONDS,
        algorithm: 'HS256',
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      },
      verifyOptions: {
        algorithms: ['HS256'],
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RoleGuard, ContributorGuard],
  exports: [AuthGuard, RoleGuard, ContributorGuard],
})
export class AuthModule {}
