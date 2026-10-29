import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Access, AccessContext, RequirePermission } from '../rbac/access';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQuery } from './dto/list-customers.query';
import { ShareCustomerDto } from './dto/share-customer.dto';
import { UpdateCustomerStatusDto } from './dto/update-customer-status.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customer', 'read')
  list(@Access() access: AccessContext, @Query() query: ListCustomersQuery) {
    return this.customers.list(access, query);
  }

  @Get(':id')
  @RequirePermission('customer', 'read')
  get(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(access, id);
  }

  @Post()
  @RequirePermission('customer', 'write')
  create(@Access() access: AccessContext, @Body() dto: CreateCustomerDto) {
    return this.customers.create(access, dto);
  }

  @Patch(':id')
  @RequirePermission('customer', 'write')
  update(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(access, id, dto);
  }

  @Patch(':id/status')
  @RequirePermission('customer', 'write')
  setStatus(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerStatusDto) {
    return this.customers.setStatus(access, id, dto.status);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('customer', 'delete')
  remove(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.remove(access, id);
  }

  @Post(':id/shares')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('customer', 'write')
  share(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShareCustomerDto) {
    return this.customers.share(access, id, dto.userId);
  }

  @Delete(':id/shares/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('customer', 'write')
  unshare(@Access() access: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.customers.unshare(access, id, userId);
  }
}
