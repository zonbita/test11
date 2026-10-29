import { Global, Module } from '@nestjs/common';
import { EnforcerService } from './enforcer.service';
import { PermissionGuard } from './permission.guard';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

// PermissionGuard is registered globally in AppModule, right after JwtAuthGuard.
@Global()
@Module({
  controllers: [RolesController],
  providers: [EnforcerService, RolesService, PermissionGuard],
  exports: [EnforcerService, PermissionGuard],
})
export class RbacModule {}
