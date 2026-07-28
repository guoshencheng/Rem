import { useMemo } from 'react';
import { RemApp, AgentRemoteService } from 'rem-agent-ui';

export default function App() {
  const service = useMemo(() => new AgentRemoteService('', { apiPrefix: '/api/rem' }), []);
  return <RemApp service={service} />;
}
