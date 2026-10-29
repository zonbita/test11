import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/auth/auth.decorators';
import { LoginThrottle } from '../../../common/http/throttle';
import { LoginDto } from '../../auth/dto/login.dto';
import { PlatformAuthService } from './platform-auth.service';

@ApiTags('platform')
@Controller('platform/api/v1/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Public()
  @LoginThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
}
