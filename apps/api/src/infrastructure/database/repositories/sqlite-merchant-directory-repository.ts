import { and, desc, eq, or, sql } from 'drizzle-orm';

import type { MerchantDirectoryRepository, MerchantRecordStatusFilter } from '../../../application/ports/merchant-directory-repository.js';
import type { MerchantCatalogItem, MerchantCatalogItemKind } from '../../../domain/merchant/merchant-catalog-item.js';
import type { MerchantCustomer } from '../../../domain/merchant/merchant-customer.js';
import type { AppDatabase } from '../connection.js';
import { merchantCatalogItems, merchantCustomers } from '../schema.js';

export class SqliteMerchantDirectoryRepository implements MerchantDirectoryRepository {
  constructor(private readonly db: AppDatabase) {}

  listCustomers(input: { ownerUserId: string; query?: string; status: MerchantRecordStatusFilter }): MerchantCustomer[] {
    const query = input.query?.trim();
    const where = and(
      eq(merchantCustomers.ownerUserId, input.ownerUserId),
      input.status === 'all' ? undefined : eq(merchantCustomers.status, input.status),
      query ? or(
        sql`instr(lower(${merchantCustomers.name}), lower(${query})) > 0`,
        sql`instr(lower(coalesce(${merchantCustomers.whatsapp}, '')), lower(${query})) > 0`,
        sql`instr(lower(coalesce(${merchantCustomers.email}, '')), lower(${query})) > 0`,
      ) : undefined,
    );
    return this.db.select().from(merchantCustomers).where(where).orderBy(desc(merchantCustomers.updatedAt)).all();
  }

  findCustomer(ownerUserId: string, id: string): MerchantCustomer | undefined {
    return this.db.select().from(merchantCustomers)
      .where(and(eq(merchantCustomers.ownerUserId, ownerUserId), eq(merchantCustomers.id, id))).get();
  }

  insertCustomer(customer: MerchantCustomer): void {
    this.db.insert(merchantCustomers).values(customer).run();
  }

  updateCustomer(customer: MerchantCustomer): boolean {
    const result = this.db.update(merchantCustomers).set({
      name: customer.name,
      whatsapp: customer.whatsapp,
      email: customer.email,
      address: customer.address,
      notes: customer.notes,
      status: customer.status,
      updatedAt: customer.updatedAt,
    }).where(and(
      eq(merchantCustomers.ownerUserId, customer.ownerUserId),
      eq(merchantCustomers.id, customer.id),
    )).run();
    return result.changes > 0;
  }

  listCatalogItems(input: { ownerUserId: string; query?: string; kind?: MerchantCatalogItemKind; status: MerchantRecordStatusFilter }): MerchantCatalogItem[] {
    const query = input.query?.trim();
    const where = and(
      eq(merchantCatalogItems.ownerUserId, input.ownerUserId),
      input.status === 'all' ? undefined : eq(merchantCatalogItems.status, input.status),
      input.kind ? eq(merchantCatalogItems.kind, input.kind) : undefined,
      query ? or(
        sql`instr(lower(${merchantCatalogItems.name}), lower(${query})) > 0`,
        sql`instr(lower(coalesce(${merchantCatalogItems.description}, '')), lower(${query})) > 0`,
      ) : undefined,
    );
    return this.db.select().from(merchantCatalogItems).where(where).orderBy(desc(merchantCatalogItems.updatedAt)).all();
  }

  findCatalogItem(ownerUserId: string, id: string): MerchantCatalogItem | undefined {
    return this.db.select().from(merchantCatalogItems)
      .where(and(eq(merchantCatalogItems.ownerUserId, ownerUserId), eq(merchantCatalogItems.id, id))).get();
  }

  insertCatalogItem(item: MerchantCatalogItem): void {
    this.db.insert(merchantCatalogItems).values(item).run();
  }

  updateCatalogItem(item: MerchantCatalogItem): boolean {
    const result = this.db.update(merchantCatalogItems).set({
      kind: item.kind,
      name: item.name,
      description: item.description,
      priceMinor: item.priceMinor,
      status: item.status,
      updatedAt: item.updatedAt,
    }).where(and(
      eq(merchantCatalogItems.ownerUserId, item.ownerUserId),
      eq(merchantCatalogItems.id, item.id),
    )).run();
    return result.changes > 0;
  }
}
