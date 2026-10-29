import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { TenantDbService } from '../tenancy/tenant-db.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { EnforcerService } from './enforcer.service';
import { replaceRoleGrants } from './role-grants';

@Injectable()
export class RolesService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly enforcers: EnforcerService,
  ) {}

  listPermissions() {
    return this.tenantDb.client.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
  }

  async list() {
    const roles = await this.tenantDb.client.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { permissions: { include: { permission: true } }, _count: { select: { memberships: true } } },
    });
    return roles.map(({ permissions, _count, ...role }) => ({
      ...role,
      memberCount: _count.memberships,
      grants: permissions.map((rp) => ({ resource: rp.permission.resource, action: rp.permission.action, scope: rp.scope })),
    }));
  }

  async create(dto: CreateRoleDto) {
    const role = await this.tenantDb.client.$transaction(async (tx) => {
      const created = await tx.role.create({ data: { key: dto.key, name: dto.name, description: dto.description } });
      await replaceRoleGrants(tx, created.id, dto.grants);
      return created;
    });
    await this.enforcers.policyChanged(this.tenantDb.tenantId);
    return role;
  }

  /** F04: system roles are not editable; custom roles are. */
  async update(roleId: string, dto: UpdateRoleDto) {
    const role = await this.findOrThrow(roleId);
    if (role.isSystem) throw new AppException(HttpStatus.CONFLICT, ErrorCode.SYSTEM_ROLE_LOCKED, 'System roles cannot be modified');
    await this.tenantDb.client.$transaction(async (tx) => {
      await tx.role.update({ where: { id: roleId }, data: { name: dto.name, description: dto.description } });
      if (dto.grants) await replaceRoleGrants(tx, roleId, dto.grants);
    });
    await this.enforcers.policyChanged(this.tenantDb.tenantId);
  }

  async remove(roleId: string) {
    const role = await this.findOrThrow(roleId);
    if (role.isSystem) throw new AppException(HttpStatus.CONFLICT, ErrorCode.SYSTEM_ROLE_LOCKED, 'System roles cannot be deleted');
    const inUse = await this.tenantDb.client.membership.count({ where: { roleId } });
    if (inUse > 0) throw new AppException(HttpStatus.CONFLICT, ErrorCode.ROLE_IN_USE, 'Role is still assigned to users');
    await this.tenantDb.client.role.delete({ where: { id: roleId } });
    await this.enforcers.policyChanged(this.tenantDb.tenantId);
  }

  private async findOrThrow(roleId: string) {
    const role = await this.tenantDb.client.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }
}
