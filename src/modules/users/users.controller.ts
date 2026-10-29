import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Access, AccessContext, RequirePermission, requireTenantScope } from '../rbac/access';
import { CreateUserDto } from './dto/create-user.dto';
import { SetMembershipsDto } from './dto/set-memberships.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

// Writes require TENANT scope: only a tenant-wide membership can reach it (see casbin/model.conf).
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('user', 'manage')
  list(@Access() access: AccessContext) {
    return this.users.list(access);
  }

  @Post()
  @RequirePermission('user', 'manage')
  create(@Access() access: AccessContext, @Body() dto: CreateUserDto) {
    requireTenantScope(access);
    return this.users.create(dto);
  }

  @Patch(':id')
  @RequirePermission('user', 'manage')
  update(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    requireTenantScope(access);
    return this.users.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermission('user', 'manage')
  setStatus(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto) {
    requireTenantScope(access);
    return this.users.setStatus(id, dto.status);
  }

  @Put(':id/memberships')
  @RequirePermission('user', 'manage')
  setMemberships(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetMembershipsDto) {
    requireTenantScope(access);
    return this.users.setMemberships(id, dto.memberships);
  }
}
