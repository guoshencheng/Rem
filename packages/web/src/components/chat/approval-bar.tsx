'use client';

import type { ApprovalDecision, ApprovalRequest } from 'rem-agent-core';
import { ShieldAlert, ShieldCheck, ShieldX, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ApprovalBarProps {
  approvals: ApprovalRequest[];
  onResolve(approvalId: string, decision: ApprovalDecision): void;
}

function severityIcon(severity?: ApprovalRequest['severity']) {
  switch (severity) {
    case 'critical':
      return <ShieldAlert size={16} />;
    case 'warning':
      return <Shield size={16} />;
    case 'info':
    default:
      return <ShieldCheck size={16} />;
  }
}

function severityClass(severity?: ApprovalRequest['severity']) {
  switch (severity) {
    case 'critical':
      return 'bg-err-bg border-err/30 text-err';
    case 'warning':
      return 'bg-warn-bg border-warn/30 text-warn';
    case 'info':
    default:
      return 'bg-ac-soft border-ac/30 text-ac';
  }
}

export function ApprovalBar({ approvals, onResolve }: ApprovalBarProps) {
  if (approvals.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mb-3">
      {approvals.map((request) => (
        <div
          key={request.approvalId}
          className={cn(
            'rounded-xl border p-3 text-sm',
            severityClass(request.severity),
          )}
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5">{severityIcon(request.severity)}</div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{request.title}</div>
              {request.description ? (
                <div className="mt-1 text-xs opacity-80 leading-relaxed">{request.description}</div>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                {request.allowedDecisions.includes('allow-once') && (
                  <button
                    type="button"
                    onClick={() => onResolve(request.approvalId, 'allow-once')}
                    className="px-2.5 py-1 rounded-lg bg-ok-bg text-ok text-xs font-medium hover:opacity-90 transition-opacity"
                  >
                    Allow once
                  </button>
                )}
                {request.allowedDecisions.includes('allow-always') && (
                  <button
                    type="button"
                    onClick={() => onResolve(request.approvalId, 'allow-always')}
                    className="px-2.5 py-1 rounded-lg bg-ok-bg text-ok text-xs font-medium hover:opacity-90 transition-opacity"
                  >
                    Always allow
                  </button>
                )}
                {request.allowedDecisions.includes('deny') && (
                  <button
                    type="button"
                    onClick={() => onResolve(request.approvalId, 'deny')}
                    className="px-2.5 py-1 rounded-lg bg-err-bg text-err text-xs font-medium hover:opacity-90 transition-opacity"
                  >
                    <span className="flex items-center gap-1">
                      <ShieldX size={12} />
                      Deny
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
