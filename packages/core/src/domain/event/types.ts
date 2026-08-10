export interface RunEvent {
  eventId: string;
  sequence: number;
  schemaVersion: 1;
  tenantId: string;
  sessionId: string;
  runId: string;
  type: string;
  data: unknown;
  occurredAt: Date;
}

export interface RunSignal {
  runId: string;
  type: string;
  data?: unknown;
  occurredAt: Date;
}
