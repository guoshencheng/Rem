export interface Principal {
  principalId: string;
  roles: string[];
  claims?: Record<string, unknown>;
}

export interface RuntimeRequestContext {
  tenantId: string;
  principal: Principal;
}
