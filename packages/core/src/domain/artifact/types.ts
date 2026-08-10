export interface Artifact {
  artifactId: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  type: string;
  mediaType: string;
  name: string;
  data?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type ArtifactDraft = Omit<
  Artifact,
  'artifactId' | 'tenantId' | 'sessionId' | 'runId' | 'createdAt'
>;
