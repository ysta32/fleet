declare module 'virtual:fleet-spend' {
  /** Synthetic example summary shipped with fleet-spend; null when the module is not installed. */
  export const DEMO_SUMMARY: Record<string, unknown> | null;
  export const SpendTab: import('react').ComponentType<import('../dashboard/Spend').SpendTabProps> | null;
}
