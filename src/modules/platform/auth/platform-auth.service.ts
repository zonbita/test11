import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../../../common/auth/auth.types';
import { ControlPrismaService } from '../../../database/control-prisma.service';
import { LoginDto } from '../../auth/dto/login.dto';
import { assertNotLocked, invalidCredentials, LockoutPolicy, onFailedAttempt, RESET_LOCKOUT } from '../../auth/login-lockout';
import { burnPasswordCheck, verifyPassword } from '../../auth/password';

@Injectable()
export class PlatformAuthService {
  private readonly lockout: LockoutPolicy;

  constructor(
    private readonly control: ControlPrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.lockout = {
      maxAttempts: config.getOrThrow<number>('LOGIN_MAX_ATTEMPTS'),
      lockMinutes: config.getOrThrow<number>('LOGIN_LOCK_MINUTES'),
    };
  }

  async login(dto: LoginDto) {
    const admin = await this.control.platformAdmin.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!admin) {
      await burnPasswordCheck(dto.password);
      throw invalidCredentials();
    }
    assertNotLocked(admin);

    if (!(await verifyPassword(admin.passwordHash, dto.password))) {
      await this.control.platformAdmin.update({ where: { id: admin.id }, data: onFailedAttempt(admin, this.lockout) });
      throw invalidCredentials();
    }

    await this.control.platformAdmin.update({ where: { id: admin.id }, data: { ...RESET_LOCKOUT, lastLoginAt: new Date() } });
    const payload: JwtPayload = { sub: admin.id, typ: 'platform' };
    return { accessToken: await this.jwt.signAsync(payload) };
  }
}
