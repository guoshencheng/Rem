import type { RuntimeAuthenticator } from 'rem-agent-service';

/** 本地 Web 宿主的认证适配；生产部署应替换为真实身份验证器。 */
export const localRuntimeAuthenticator: RuntimeAuthenticator = {
  authenticate: (request) => ({
    tenantId: request.headers.get('x-tenant-id')?.trim() || 'local-web',
    principal: {
      principalId: request.headers.get('x-principal-id')?.trim() || 'web-user',
      roles: ['web-user'],
    },
  }),
};
