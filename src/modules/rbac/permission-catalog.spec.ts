import { DataScope } from '../../generated/tenant/enums';
import { PERMISSIONS, SYSTEM_ROLES } from './permission-catalog';

const { OWN, COMPANY, TENANT } = DataScope;
type Matrix = Record<string, DataScope>;

/**
 * PRD §1.8 matrix, locked. Changing a system role must update this table on purpose.
 * Marked "(+)" = not in the §1.8 table, added because the role cannot work without it.
 */
const EXPECTED: Record<string, Matrix> = {
  tenant_admin: {
    'company.read': TENANT, // (+) company selector
    'company.manage': TENANT,
    'settings.manage': TENANT,
    'user.manage': TENANT,
    'role.manage': TENANT,
    'bank.connect': TENANT,
    'dashboard.view': TENANT,
    'customer.read': TENANT,
    'customer.write': TENANT,
    'customer.delete': TENANT, // (+) PRD §3 "xóa khách" is a sensitive permission
    'product.read': TENANT, // (+) F07 users: Admin, Chủ DN
    'product.manage': TENANT, // (+) F07
    'quote.read': TENANT,
    'quote.write': TENANT,
    'invoice.read': TENANT, // (+) read-only; no create/validate/credit note/payment
    'report.view': TENANT,
    'export.fec': TENANT,
    'audit.view': TENANT,
  },
  owner: {
    'company.read': COMPANY,
    'bank.connect': COMPANY,
    'dashboard.view': COMPANY,
    'customer.read': COMPANY,
    'customer.write': COMPANY,
    'customer.delete': COMPANY,
    'product.read': COMPANY,
    'product.manage': COMPANY,
    'quote.read': COMPANY,
    'quote.write': COMPANY,
    'quote.approve': COMPANY,
    'invoice.read': COMPANY,
    'invoice.create': COMPANY,
    'invoice.validate': COMPANY,
    'credit_note.create': COMPANY,
    'payment.record': COMPANY,
    'payment.reconcile': COMPANY,
    'report.view': COMPANY,
    'export.fec': COMPANY,
    'audit.view': COMPANY,
    'ai.use': COMPANY,
  },
  accountant: {
    'company.read': COMPANY,
    'dashboard.view': COMPANY,
    'customer.read': COMPANY,
    'product.read': COMPANY,
    'quote.read': COMPANY,
    'invoice.read': COMPANY,
    'invoice.create': COMPANY,
    'invoice.validate': COMPANY,
    'credit_note.create': COMPANY,
    'payment.record': COMPANY,
    'payment.reconcile': COMPANY,
    'report.view': COMPANY,
    'export.fec': COMPANY,
    'ai.use': COMPANY,
  },
  sales: {
    'company.read': COMPANY,
    'dashboard.view': OWN,
    'customer.read': OWN,
    'customer.write': OWN,
    'product.read': COMPANY,
    'quote.read': OWN,
    'quote.write': OWN,
    'invoice.read': OWN,
    'invoice.request': OWN,
    'ai.use': OWN,
  },
  viewer: {
    'company.read': COMPANY,
    'customer.read': COMPANY,
    'product.read': COMPANY, // (+) to read quote lines
    'quote.read': COMPANY,
  },
};

const actual = (key: string): Matrix => {
  const role = SYSTEM_ROLES.find((r) => r.key === key)!;
  return Object.fromEntries(role.grants.map((g) => [`${g.resource}.${g.action}`, g.scope]));
};

describe('system roles = PRD §1.8 matrix', () => {
  it('defines exactly the five system roles', () => {
    expect(SYSTEM_ROLES.map((r) => r.key).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  // Every role x every permission: granted with the exact scope, or not granted at all
  const codes = PERMISSIONS.map((p) => `${p.resource}.${p.action}`);
  for (const role of Object.keys(EXPECTED)) {
    it.each(codes)(`${role} / %s`, (code) => {
      expect(actual(role)[code]).toBe(EXPECTED[role][code]);
    });
  }

  it('grants only catalog permissions, never wildcards, never duplicated', () => {
    const catalog = new Set(codes);
    for (const role of SYSTEM_ROLES) {
      const granted = role.grants.map((g) => `${g.resource}.${g.action}`);
      expect(granted.filter((c) => !catalog.has(c))).toEqual([]);
      expect(new Set(granted).size).toBe(granted.length);
      expect(granted.some((c) => c.includes('*'))).toBe(false);
    }
  });

  it('keeps financial actions away from the tenant admin and the viewer', () => {
    const financial = ['quote.approve', 'invoice.create', 'invoice.validate', 'credit_note.create', 'payment.record', 'payment.reconcile'];
    for (const role of ['tenant_admin', 'viewer']) {
      expect(financial.filter((c) => actual(role)[c])).toEqual([]);
    }
  });

  it('only the tenant admin administers the tenant, always at TENANT scope', () => {
    for (const code of ['company.manage', 'settings.manage', 'user.manage', 'role.manage']) {
      const holders = SYSTEM_ROLES.filter((r) => actual(r.key)[code]).map((r) => r.key);
      expect({ code, holders }).toEqual({ code, holders: ['tenant_admin'] });
      expect(actual('tenant_admin')[code]).toBe(TENANT);
    }
  });

  it('audit log is limited to admin and owner; accountant and viewer cannot read it', () => {
    expect(
      SYSTEM_ROLES.filter((r) => actual(r.key)['audit.view'])
        .map((r) => r.key)
        .sort(),
    ).toEqual(['owner', 'tenant_admin']);
  });
});
