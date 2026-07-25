'use client';

import { useState } from 'react';
import type { ProviderCredential } from 'rem-agent-bridge/local';

interface CredentialSetupProps {
  initial?: ProviderCredential | null;
  onSave(credential: ProviderCredential): void | Promise<void>;
  onCancel?(): void;
}

const PROVIDER_PRESETS: Record<string, { label: string; modelPlaceholder: string; showBaseURL: boolean }> = {
  anthropic: { label: 'Anthropic', modelPlaceholder: 'claude-sonnet-4-5', showBaseURL: false },
  openai: { label: 'OpenAI', modelPlaceholder: 'gpt-4o', showBaseURL: false },
  'minimax-openai': { label: 'MiniMax', modelPlaceholder: 'MiniMax-M3', showBaseURL: false },
  openrouter: { label: 'OpenRouter', modelPlaceholder: 'anthropic/claude-sonnet-4-5', showBaseURL: true },
  custom: { label: 'Custom (OpenAI-compatible)', modelPlaceholder: 'model name', showBaseURL: true },
};

export function CredentialSetup({ initial, onSave, onCancel }: CredentialSetupProps) {
  const [provider, setProvider] = useState(initial?.provider ?? 'anthropic');
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [baseURL, setBaseURL] = useState(initial?.baseURL ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const preset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.custom;

  const handleProviderChange = (id: string) => {
    setProvider(id);
    // 切换 provider 时，若 model 为空或还是其他预设的默认值，换成新预设的默认模型
    const isPresetValue = Object.values(PROVIDER_PRESETS).some((p) => p.modelPlaceholder === model);
    if (!model.trim() || isPresetValue) {
      setModel(PROVIDER_PRESETS[id]?.modelPlaceholder ?? '');
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSave({
        provider,
        apiKey: apiKey.trim(),
        model: model.trim() || preset.modelPlaceholder || undefined,
        baseURL: baseURL.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-card border border-bd p-6 rounded-lg w-full max-w-md shadow-xl">
      <h2 className="text-lg font-semibold text-tx mb-1">Connect a provider</h2>
      <p className="text-xs text-tx3 mb-4">Your API key is stored in this browser (IndexedDB) and sent directly to the provider.</p>

      <label className="block text-sm text-tx2 mb-1">Provider</label>
      <select
        className="w-full bg-bd border border-bd2 rounded px-3 py-2 mb-3 text-tx text-sm outline-none"
        value={provider}
        onChange={(e) => handleProviderChange(e.target.value)}
        disabled={submitting}
      >
        {Object.entries(PROVIDER_PRESETS).map(([id, p]) => (
          <option key={id} value={id}>{p.label}</option>
        ))}
      </select>

      <label className="block text-sm text-tx2 mb-1">API Key</label>
      <input
        type="password"
        className="w-full bg-bd border border-bd2 rounded px-3 py-2 mb-3 text-tx text-sm outline-none"
        value={apiKey}
        onChange={(e) => { setApiKey(e.target.value); setError(null); }}
        placeholder="sk-..."
        disabled={submitting}
      />

      <label className="block text-sm text-tx2 mb-1">Model</label>
      <input
        className="w-full bg-bd border border-bd2 rounded px-3 py-2 mb-3 text-tx text-sm outline-none"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder={preset.modelPlaceholder}
        disabled={submitting}
      />

      {preset.showBaseURL && (
        <>
          <label className="block text-sm text-tx2 mb-1">Base URL</label>
          <input
            className="w-full bg-bd border border-bd2 rounded px-3 py-2 mb-3 text-tx text-sm outline-none"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="https://..."
            disabled={submitting}
          />
        </>
      )}

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            className="px-4 py-2 rounded-btn text-sm text-tx2 hover:bg-bd transition-colors"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
        <button
          className="px-4 py-2 rounded-btn bg-ac text-ac-ink text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          onClick={() => void handleSave()}
          disabled={submitting}
        >
          {submitting ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
