import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformOnly } from '../../../common/auth/auth.decorators';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { RetryProvisioningDto } from './dto/retry-provisioning.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { TenantsService } from './tenants.service';

@ApiTags('platform')
@ApiBearerAuth()
@PlatformOnly()
@Controller('platform/api/v1/tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.get(id);
  }

  // TODO(F01 G): answer 202 + job id once provisioning runs in a background job (BullMQ)
  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Post(':id/retry')
  retry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryProvisioningDto) {
    return this.tenants.retry(id, dto.adminPassword);
  }

  @Patch(':id/status')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.tenants.setStatus(id, dto);
  }
}
