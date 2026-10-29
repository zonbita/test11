import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Access, AccessContext, RequirePermission, requireTenantScope } from './access';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

// Role administration is tenant-wide: a company-level membership never reaches TENANT scope.
@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermission('role', 'manage')
  listPermissions() {
    return this.roles.listPermissions();
  }

  @Get()
  @RequirePermission('role', 'manage')
  list() {
    return this.roles.list();
  }

  @Post()
  @RequirePermission('role', 'manage')
  create(@Access() access: AccessContext, @Body() dto: CreateRoleDto) {
    requireTenantScope(access);
    return this.roles.create(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('role', 'manage')
  update(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    requireTenantScope(access);
    return this.roles.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('role', 'manage')
  remove(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    requireTenantScope(access);
    return this.roles.remove(id);
  }
}
