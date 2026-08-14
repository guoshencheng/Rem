import { useEffect, useState } from 'react';
import type { AgentDefinition } from 'rem-agent-core';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/api/client';

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (sessionId: string) => void;
  agentId: string;
  onAgentChange: (agentId: string) => void;
}

export function NewSessionDialog({
  open, onOpenChange, onCreated, agentId, onAgentChange,
}: NewSessionDialogProps) {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    void api.listAgents().then((items) => {
      setAgents(items);
      if (items.length > 0 && !items.some((item) => item.agentId === agentId)) onAgentChange(items[0].agentId);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [open]);

  const create = async () => {
    setCreating(true); setError(undefined);
    try {
      const info = await api.createSession();
      onOpenChange(false); onCreated(info.sessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setCreating(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>新建 Session</DialogTitle></DialogHeader>
        <Select value={agentId} onValueChange={onAgentChange}>
          <SelectTrigger><SelectValue placeholder="选择 Agent" /></SelectTrigger>
          <SelectContent>{agents.map((agent) => (
            <SelectItem key={`${agent.agentId}:${agent.revision}`} value={agent.agentId}>
              {agent.name} · {agent.agentId}
            </SelectItem>
          ))}</SelectContent>
        </Select>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button onClick={create} disabled={creating}>{creating ? '创建中…' : '创建'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
