import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

export interface TenantDbCredentials {
  dbName: string;
  dbUser: string;
  password: string;
}

/**
 * Creates one PostgreSQL database + login role per tenant, using the admin connection.
 * The tenant role owns only its own database; PUBLIC cannot connect to it.
 */
@Injectable()
export class TenantProvisionerService {
  private readonly logger = new Logger(TenantProvisionerService.name);

  constructor(private readonly config: ConfigService) {}

  credentialsFor(subdomain: string): TenantDbCredentials {
    const name = `tenant_${subdomain.replace(/-/g, '_')}`;
    return { dbName: name, dbUser: name, password: randomBytes(24).toString('hex') };
  }

  async createDatabase({ dbName, dbUser, password }: TenantDbCredentials) {
    assertIdentifier(dbName);
    assertIdentifier(dbUser);
    await this.withAdmin(async (client) => {
      // DDL cannot take bind parameters; identifiers are validated and the password is hex.
      await client.query(`CREATE ROLE "${dbUser}" LOGIN PASSWORD '${password}'`);
      await client.query(`CREATE DATABASE "${dbName}" OWNER "${dbUser}"`);
      await client.query(`REVOKE ALL ON DATABASE "${dbName}" FROM PUBLIC`);
    });
    this.logger.log(`Created database ${dbName}`);
  }

  /** Cleanup after a failed provisioning. */
  async dropDatabase(dbName: string, dbUser: string) {
    assertIdentifier(dbName);
    assertIdentifier(dbUser);
    await this.withAdmin(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await client.query(`DROP ROLE IF EXISTS "${dbUser}"`);
    });
  }

  private async withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: this.config.getOrThrow<string>('TENANT_DB_ADMIN_URL') });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }
}

function assertIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
}
