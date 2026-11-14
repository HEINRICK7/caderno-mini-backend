export type MerchantChargeSourceType = 'sale' | 'sale_installment' | 'sale_payment' | 'recurring_charge' | 'recurring_payment';

export type MerchantChargeMessageRecord = {
  id: string;
  ownerUserId: string;
  customerId: string;
  sourceType: MerchantChargeSourceType;
  sourceId: string;
  draftId: string;
  createdAt: Date;
};

export type MerchantChargeMessageSummary = MerchantChargeMessageRecord & {
  templateId: string;
  templateName: string;
};

export interface MerchantChargeMessageRepository {
  findByDraft(draftId: string): MerchantChargeMessageRecord | undefined;
  insertOrGet(record: MerchantChargeMessageRecord): MerchantChargeMessageRecord;
  listForCustomer(ownerUserId: string, customerId: string): MerchantChargeMessageSummary[];
}
