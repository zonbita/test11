import { Module } from '@nestjs/common';
import { PlatformAuthController } from './auth/platform-auth.controller';
import { PlatformAuthService } from './auth/platform-auth.service';
import { TenantProvisionerService } from './tenants/tenant-provisioner.service';
import { TenantsController } from './tenants/tenants.controller';
import { TenantsService } from './tenants/tenants.service';

@Module({
  controllers: [PlatformAuthController, TenantsController],
  providers: [PlatformAuthService, TenantsService, TenantProvisionerService],
})
export class PlatformModule {}
