import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';
import type { TeamInfo } from 'rem-agent-core';

const SINGLE = '__single__';

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (sessionId: string) => void;
}

export function NewSessionDialog({ open, onOpenChange, onCreated }: NewSessionDialogProps) {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [teamId, setTeamId] = useState(SINGLE);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) void api.listTeams().then(setTeams).catch((e: Error) => setError(e.message));
  }, [open]);

  const create = async () => {
    setCreating(true);
    setError(undefined);
    try {
      const info = await api.createSession(teamId === SINGLE ? undefined : teamId);
      onOpenChange(false);
      onCreated(info.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建 Session</DialogTitle>
        </DialogHeader>
        <Select value={teamId} onValueChange={setTeamId}>
          <SelectTrigger>
            <SelectValue placeholder="选择类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={SINGLE}>单 Agent</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  Team: {t.id}（{t.organizer} + {t.members.length} 成员）
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button onClick={create} disabled={creating}>
            {creating ? '创建中…' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
