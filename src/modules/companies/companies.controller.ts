import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthOnly, CurrentUser } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { Access, AccessContext, RequirePermission, requireTenantScope } from '../rbac/access';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @AuthOnly()
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.companies.listForUser(user.id);
  }

  @Post()
  @RequirePermission('company', 'manage')
  create(@Access() access: AccessContext, @Body() dto: CreateCompanyDto) {
    requireTenantScope(access);
    return this.companies.create(dto);
  }

  @Patch(':id')
  @RequirePermission('company', 'manage')
  update(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(access, id, dto);
  }
}
