'use client';

import { useState } from 'react';
import type { ApprovalDecision, ApprovalRequest, Rule } from 'rem-agent-core';
import { ShieldAlert, ShieldCheck, ShieldX, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ApprovalBarProps {
  approvals: ApprovalRequest[];
  onResolve(approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): void;
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
  const [selectedRule, setSelectedRule] = useState<Record<string, Omit<Rule, 'source'> | undefined>>({});

  if (approvals.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {approvals.map((request) => {
        const options = request.alwaysOptions ?? [];
        const showAlways = request.allowedDecisions.includes('allow-always') && options.length > 0;
        const defaultOption = options[0];
        const activeRule = selectedRule[request.approvalId] ?? defaultOption?.rule;

        return (
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

                {showAlways && (
                  <div className="mt-2">
                    <label className="text-xs opacity-70">Always allow scope:</label>
                    <select
                      className="mt-1 block w-full text-xs rounded border bg-bg px-2 py-1"
                      value={activeRule?.pattern ?? ''}
                      onChange={(e) => {
                        const option = options.find((o) => o.rule.pattern === e.target.value);
                        setSelectedRule((prev) => ({ ...prev, [request.approvalId]: option?.rule }));
                      }}
                    >
                      {options.map((option) => (
                        <option key={option.rule.pattern} value={option.rule.pattern}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

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
                      onClick={() => onResolve(request.approvalId, 'allow-always', activeRule)}
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
        );
      })}
    </div>
  );
}

