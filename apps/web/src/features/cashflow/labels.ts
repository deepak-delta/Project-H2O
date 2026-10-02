import type { CashFlowCategory, PaymentMethod } from '@wd/shared';

export const CATEGORY_LABEL: Record<CashFlowCategory, string> = {
  WATER_SALE: 'Water sales',
  DEPOSIT: 'Can deposits',
  CREDIT_RECOVERY: 'Old dues collected',
  OTHER_INCOME: 'Other income',
  FUEL: 'Fuel',
  WATER_PURCHASE: 'Water purchase',
  VEHICLE: 'Vehicle',
  SALARY: 'Salary',
  MAINTENANCE: 'Maintenance',
  ELECTRICITY: 'Electricity',
  MISC: 'Other expense',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank',
  OTHER: 'Other',
};
