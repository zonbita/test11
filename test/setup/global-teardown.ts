import './env';
import { purgeE2eTenants } from '../support/db';

export default async function globalTeardown() {
  if (process.env.E2E_KEEP_TENANTS !== 'true') await purgeE2eTenants();
}
