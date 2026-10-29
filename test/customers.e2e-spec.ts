import { NestExpressApplication } from '@nestjs/platform-express';
import { Api, billingAddress, createTestApp, hostOf, uniqueSubdomain } from './support/app';
import { withTenantDb } from './support/db';

const VALID_SIRET = '73282932000074';
const VALID_IBAN = 'FR7630006000011234567890189';

describe('Companies & customers (F03, F06)', () => {
  let app: NestExpressApplication;
  let api: Api;
  const sub = uniqueSubdomain('cust');
  const host = hostOf(sub);
  let admin: string;
  let company: string;

  const call = (method: Parameters<Api['call']>[0], path: string, body?: object, extra: { company?: string | null } = {}) =>
    api.call(method, path, { host, token: admin, company: extra.company === null ? undefined : (extra.company ?? company), body });

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    await api.createTenant(await api.platformToken(), sub);
    admin = await api.adminLogin(sub);
    company = (await api.call('get', '/api/v1/companies', { host, token: admin })).body[0].id;
  });
  afterAll(() => app.close());

  describe('companies (F03)', () => {
    it('validates SIRET (Luhn) and IBAN (mod 97) with 422 per field (AC-03)', async () => {
      const res = await call(
        'patch',
        `/api/v1/companies/${company}`,
        { siret: '73282932000075', iban: 'FR7630006000011234567890188' },
        { company: null },
      );
      expect(res.status).toBe(422);
      expect(res.body.fields.map((f: { field: string; code: string }) => `${f.field}:${f.code}`).sort()).toEqual([
        'iban:isIban',
        'siret:isSiret',
      ]);
    });

    it('requires the legal data of a French company (AC-01)', async () => {
      const res = await call('post', '/api/v1/companies', { legalName: 'DFM ROMANIA FR', countryCode: 'FR' }, { company: null });
      expect(res.status).toBe(422);
      expect(res.body.fields.map((f: { field: string }) => f.field).sort()).toEqual([
        'addressLine1',
        'city',
        'iban',
        'postalCode',
        'siret',
        'vatNumber',
      ]);

      const ok = await call(
        'post',
        '/api/v1/companies',
        {
          legalName: 'DFM PARIS',
          countryCode: 'FR',
          siret: '732 829 320 00074',
          vatNumber: 'FR44732829320',
          iban: 'fr76 3000 6000 0112 3456 7890 189',
          addressLine1: '1 rue X',
          postalCode: '75001',
          city: 'Paris',
        },
        { company: null },
      );
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ siret: VALID_SIRET, iban: VALID_IBAN, status: 'ACTIVE' });
    });

    it('seeds French VAT rates; a 0% rate needs a legal mention (BR-04)', async () => {
      const rates = await call('get', `/api/v1/companies/${company}/tax-rates`);
      expect(rates.body.map((r: { rate: string }) => Number(r.rate))).toEqual([20, 10, 5.5, 2.1, 0]);

      const bad = await call('post', `/api/v1/companies/${company}/tax-rates`, { rate: '0', label: 'Exonéré' });
      expect(bad.status).toBe(422);
      expect(bad.body.fields[0].field).toBe('legalMention');

      const ok = await call('post', `/api/v1/companies/${company}/tax-rates`, {
        rate: '0',
        label: 'Exonéré',
        legalMention: 'TVA non applicable, art. 293 B du CGI',
      });
      expect(ok.status).toBe(201);
    });

    it('enforces the 0% legal mention in the database too (CHECK constraint)', async () => {
      await withTenantDb(sub, async (db) => {
        await expect(
          db.query(`INSERT INTO tax_rates (id, company_id, rate, label, updated_at) VALUES (gen_random_uuid(), $1, 0, 'raw', now())`, [
            company,
          ]),
        ).rejects.toThrow(/tax_rates_zero_rate_mention_check/);
      });
    });
  });

  describe('customers (F06)', () => {
    it('assigns sequential, per-company codes C00001, C00002 (AC-01, BR-02)', async () => {
      const first = await call('post', '/api/v1/customers', {
        type: 'COMPANY',
        name: 'SNCF',
        siret: VALID_SIRET,
        addresses: [billingAddress],
      });
      const second = await call('post', '/api/v1/customers', {
        type: 'INDIVIDUAL',
        firstName: 'Jean',
        lastName: 'Dupont',
        addresses: [billingAddress],
      });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect([first.body.code, second.body.code]).toEqual(['C00001', 'C00002']);
      expect(second.body.name).toBe('Jean Dupont');
    });

    it('does not accept a client-supplied code, nor allow changing it', async () => {
      const create = await call('post', '/api/v1/customers', { type: 'COMPANY', name: 'X', code: 'HACK', addresses: [billingAddress] });
      expect(create.status).toBe(422);
      const id = (await call('get', '/api/v1/customers')).body.items[0].id;
      const update = await call('patch', `/api/v1/customers/${id}`, { code: 'HACK' });
      expect(update.status).toBe(422);
    });

    it('requires a billing address (BR-01) and a valid SIRET', async () => {
      const noAddress = await call('post', '/api/v1/customers', { type: 'COMPANY', name: 'X', addresses: [] });
      expect(noAddress.status).toBe(422);
      const shippingOnly = await call('post', '/api/v1/customers', {
        type: 'COMPANY',
        name: 'X',
        addresses: [{ ...billingAddress, type: 'SHIPPING' }],
      });
      expect(shippingOnly.status).toBe(422);
      expect(shippingOnly.body.fields[0]).toMatchObject({ field: 'addresses', code: 'billingRequired' });
      const badSiret = await call('post', '/api/v1/customers', {
        type: 'COMPANY',
        name: 'X',
        siret: '12345678901234',
        addresses: [billingAddress],
      });
      expect(badSiret.status).toBe(422);
    });

    it('drops SIRET/TVA for an individual (AC-02)', async () => {
      const res = await call('post', '/api/v1/customers', {
        type: 'INDIVIDUAL',
        lastName: 'Martin',
        siret: VALID_SIRET,
        vatNumber: 'FR00',
        addresses: [billingAddress],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Martin', siret: null, vatNumber: null });
    });

    it('manages contacts and addresses, keeping at least one billing address', async () => {
      const customer = (await call('post', '/api/v1/customers', { type: 'COMPANY', name: 'Addr Co', addresses: [billingAddress] })).body;
      const billingId = customer.addresses[0].id;

      const contact = await call('post', `/api/v1/customers/${customer.id}/contacts`, {
        lastName: 'Durand',
        email: 'd@x.test',
        isPrimary: true,
      });
      expect(contact.status).toBe(201);
      expect((await call('patch', `/api/v1/customers/${customer.id}/contacts/${contact.body.id}`, { jobTitle: 'CFO' })).body.jobTitle).toBe(
        'CFO',
      );
      expect((await call('delete', `/api/v1/customers/${customer.id}/contacts/${contact.body.id}`)).status).toBe(204);

      const lastBilling = await call('delete', `/api/v1/customers/${customer.id}/addresses/${billingId}`);
      expect(lastBilling.status).toBe(409);
      expect(lastBilling.body.code).toBe('LAST_BILLING_ADDRESS');
      expect((await call('patch', `/api/v1/customers/${customer.id}/addresses/${billingId}`, { type: 'SHIPPING' })).status).toBe(409);

      const second = await call('post', `/api/v1/customers/${customer.id}/addresses`, { ...billingAddress, city: 'Lyon' });
      expect(second.status).toBe(201);
      expect((await call('delete', `/api/v1/customers/${customer.id}/addresses/${billingId}`)).status).toBe(204);
    });

    it('archives instead of deleting a customer with documents (AC-05)', async () => {
      const customer = (await call('post', '/api/v1/customers', { type: 'COMPANY', name: 'Has docs', addresses: [billingAddress] })).body;
      await withTenantDb(sub, (db) =>
        db.query(
          `INSERT INTO quotes (id, company_id, number, issue_date, valid_until, customer_id, owner_id, currency, updated_at)
           VALUES (gen_random_uuid(), $1, 'DEV20260001', now(), now(), $2, $3, 'EUR', now())`,
          [company, customer.id, customer.ownerId],
        ),
      );
      const del = await call('delete', `/api/v1/customers/${customer.id}`);
      expect(del.status).toBe(409);
      expect(del.body.code).toBe('CUSTOMER_HAS_DOCUMENTS');

      expect((await call('patch', `/api/v1/customers/${customer.id}/status`, { status: 'ARCHIVED' })).body.status).toBe('ARCHIVED');
      const active = await call('get', '/api/v1/customers', undefined);
      expect(active.body.items.map((c: { id: string }) => c.id)).not.toContain(customer.id);
      const archived = await api.call('get', '/api/v1/customers?status=ARCHIVED', { host, token: admin, company });
      expect(archived.body.items.map((c: { id: string }) => c.id)).toContain(customer.id);
    });

    it('moves a customer without documents to the trash', async () => {
      const customer = (await call('post', '/api/v1/customers', { type: 'COMPANY', name: 'Trash me', addresses: [billingAddress] })).body;
      expect((await call('delete', `/api/v1/customers/${customer.id}`)).status).toBe(204);
      expect((await call('get', `/api/v1/customers/${customer.id}`)).status).toBe(404);
    });
  });
});
