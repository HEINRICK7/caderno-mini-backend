import type { MerchantDirectoryRepository, MerchantRecordStatusFilter } from '../ports/merchant-directory-repository.js';
import { createMerchantCatalogItem, updateMerchantCatalogItem, type MerchantCatalogItemInput, type MerchantCatalogItemKind } from '../../domain/merchant/merchant-catalog-item.js';
import { createMerchantCustomer, updateMerchantCustomer, type MerchantCustomerInput } from '../../domain/merchant/merchant-customer.js';

export class MerchantRecordNotFoundError extends Error {
  constructor() {
    super('Merchant record not found.');
    this.name = 'MerchantRecordNotFoundError';
  }
}

type Dependencies = {
  records: MerchantDirectoryRepository;
  generateId: () => string;
  clock: () => Date;
};

export function listMerchantCustomers(
  input: { ownerUserId: string; query?: string; status?: MerchantRecordStatusFilter },
  dependencies: Pick<Dependencies, 'records'>,
) {
  return dependencies.records.listCustomers({
    ownerUserId: input.ownerUserId,
    ...(input.query ? { query: input.query.trim() } : {}),
    status: input.status ?? 'active',
  });
}

export function createMerchantCustomerRecord(
  input: MerchantCustomerInput & { ownerUserId: string },
  dependencies: Dependencies,
) {
  const customer = createMerchantCustomer({
    ...input,
    id: dependencies.generateId(),
    now: dependencies.clock(),
  });
  dependencies.records.insertCustomer(customer);
  return customer;
}

export function updateMerchantCustomerRecord(
  input: MerchantCustomerInput & { ownerUserId: string; id: string },
  dependencies: Pick<Dependencies, 'records' | 'clock'>,
) {
  const current = dependencies.records.findCustomer(input.ownerUserId, input.id);
  if (!current) throw new MerchantRecordNotFoundError();
  const customer = updateMerchantCustomer(current, input, dependencies.clock());
  if (!dependencies.records.updateCustomer(customer)) throw new MerchantRecordNotFoundError();
  return customer;
}

export function getMerchantCustomer(
  input: { ownerUserId: string; id: string },
  dependencies: Pick<Dependencies, 'records'>,
) {
  const customer = dependencies.records.findCustomer(input.ownerUserId, input.id);
  if (!customer) throw new MerchantRecordNotFoundError();
  return customer;
}

export function listMerchantCatalogItems(
  input: { ownerUserId: string; query?: string; kind?: MerchantCatalogItemKind; status?: MerchantRecordStatusFilter },
  dependencies: Pick<Dependencies, 'records'>,
) {
  return dependencies.records.listCatalogItems({
    ownerUserId: input.ownerUserId,
    ...(input.query ? { query: input.query.trim() } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    status: input.status ?? 'active',
  });
}

export function createMerchantCatalogItemRecord(
  input: MerchantCatalogItemInput & { ownerUserId: string },
  dependencies: Dependencies,
) {
  const item = createMerchantCatalogItem({
    ...input,
    id: dependencies.generateId(),
    now: dependencies.clock(),
  });
  dependencies.records.insertCatalogItem(item);
  return item;
}

export function updateMerchantCatalogItemRecord(
  input: MerchantCatalogItemInput & { ownerUserId: string; id: string },
  dependencies: Pick<Dependencies, 'records' | 'clock'>,
) {
  const current = dependencies.records.findCatalogItem(input.ownerUserId, input.id);
  if (!current) throw new MerchantRecordNotFoundError();
  const item = updateMerchantCatalogItem(current, input, dependencies.clock());
  if (!dependencies.records.updateCatalogItem(item)) throw new MerchantRecordNotFoundError();
  return item;
}

export function getMerchantCatalogItem(
  input: { ownerUserId: string; id: string },
  dependencies: Pick<Dependencies, 'records'>,
) {
  const item = dependencies.records.findCatalogItem(input.ownerUserId, input.id);
  if (!item) throw new MerchantRecordNotFoundError();
  return item;
}
