import type { MerchantCatalogItem, MerchantCatalogItemKind } from '../../domain/merchant/merchant-catalog-item.js';
import type { MerchantCustomer, MerchantCustomerStatus } from '../../domain/merchant/merchant-customer.js';

export type MerchantRecordStatusFilter = MerchantCustomerStatus | 'all';

export type MerchantDirectoryRepository = {
  listCustomers(input: { ownerUserId: string; query?: string; status: MerchantRecordStatusFilter }): MerchantCustomer[];
  findCustomer(ownerUserId: string, id: string): MerchantCustomer | undefined;
  insertCustomer(customer: MerchantCustomer): void;
  updateCustomer(customer: MerchantCustomer): boolean;
  listCatalogItems(input: { ownerUserId: string; query?: string; kind?: MerchantCatalogItemKind; status: MerchantRecordStatusFilter }): MerchantCatalogItem[];
  findCatalogItem(ownerUserId: string, id: string): MerchantCatalogItem | undefined;
  insertCatalogItem(item: MerchantCatalogItem): void;
  updateCatalogItem(item: MerchantCatalogItem): boolean;
};
