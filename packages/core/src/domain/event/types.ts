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

/** Optional execution-graph origin for signals emitted by Team/member nodes. */
export interface RunSignalSource {
  nodeId: string;
  agentId: string;
  role: string;
}

export interface RunSignal {
  runId: string;
  type: string;
  data?: unknown;
  source?: RunSignalSource;
  occurredAt: Date;
}
