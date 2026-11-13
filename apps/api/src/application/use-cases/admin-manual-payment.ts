import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { AdminPaymentMethod, AdminRepository } from '../ports/admin-repository.js';

export function recordAdminManualPayment(
  input: {
    userId: string;
    draftId: string;
    actorEmail: string;
    plan: 'annual' | 'lifetime';
    amountMinor: number;
    paymentMethod: AdminPaymentMethod;
    paymentReference?: string;
  },
  dependencies: {
    admin: Pick<AdminRepository, 'recordManualPayment'>;
    generateId?: () => string;
    clock?: () => Date;
  },
) {
  const generateId = dependencies.generateId ?? randomUUID;
  const callbackHash = createHash('sha256').update(randomBytes(32)).digest('hex');

  return dependencies.admin.recordManualPayment({
    ...input,
    purchaseId: generateId(),
    callbackHash,
    auditId: generateId(),
    grantId: generateId(),
    now: (dependencies.clock ?? (() => new Date()))(),
  });
}
