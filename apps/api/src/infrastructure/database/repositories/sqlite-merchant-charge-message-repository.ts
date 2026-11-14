import { and, desc, eq } from 'drizzle-orm';

import type { MerchantChargeMessageRepository, MerchantChargeMessageRecord, MerchantChargeMessageSummary } from '../../../application/ports/merchant-charge-message-repository.js';
import type { AppDatabase } from '../connection.js';
import { drafts, merchantChargeMessages, templates } from '../schema.js';

export class SqliteMerchantChargeMessageRepository implements MerchantChargeMessageRepository {
  constructor(private readonly db: AppDatabase) {}

  findByDraft(draftId: string): MerchantChargeMessageRecord | undefined {
    return this.db.select().from(merchantChargeMessages)
      .where(eq(merchantChargeMessages.draftId, draftId)).get();
  }

  insertOrGet(record: MerchantChargeMessageRecord): MerchantChargeMessageRecord {
    return this.db.transaction((tx) => {
      const existing = tx.select().from(merchantChargeMessages)
        .where(eq(merchantChargeMessages.draftId, record.draftId)).get();
      if (existing) return existing;
      tx.insert(merchantChargeMessages).values(record).run();
      return record;
    });
  }

  listForCustomer(ownerUserId: string, customerId: string): MerchantChargeMessageSummary[] {
    return this.db.select({
      id: merchantChargeMessages.id,
      ownerUserId: merchantChargeMessages.ownerUserId,
      customerId: merchantChargeMessages.customerId,
      sourceType: merchantChargeMessages.sourceType,
      sourceId: merchantChargeMessages.sourceId,
      draftId: merchantChargeMessages.draftId,
      createdAt: merchantChargeMessages.createdAt,
      templateId: drafts.templateId,
      templateName: templates.name,
    }).from(merchantChargeMessages)
      .innerJoin(drafts, eq(drafts.id, merchantChargeMessages.draftId))
      .leftJoin(templates, and(
        eq(templates.id, drafts.templateId),
        eq(templates.version, drafts.templateVersion),
      ))
      .where(and(
        eq(merchantChargeMessages.ownerUserId, ownerUserId),
        eq(merchantChargeMessages.customerId, customerId),
      ))
      .orderBy(desc(merchantChargeMessages.createdAt))
      .all()
      .map((row) => ({ ...row, templateName: row.templateName ?? row.templateId }));
  }
}
