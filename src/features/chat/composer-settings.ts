import type { TurnOptions } from './use-turn';

export interface ComposerSettings {
  stream: boolean;
  retrievalOff: boolean;
  /** Empty: every base the agent uses. */
  narrowTo: string[];
  temperature: string;
  maxOutputTokens: string;
}

export const defaultComposerSettings = (): ComposerSettings => ({
  stream: true,
  retrievalOff: false,
  narrowTo: [],
  temperature: '',
  maxOutputTokens: '',
});

/** The per-turn overrides (§6 "Send / stream"), or the reason they can't be used. */
export function turnOptionsOf(settings: ComposerSettings): { options: TurnOptions | null; error: string | null } {
  const options: TurnOptions = { stream: settings.stream };
  if (settings.temperature.trim()) {
    const value = Number(settings.temperature);
    if (!Number.isFinite(value) || value < 0 || value > 2) return { options: null, error: 'Temperature must be between 0 and 2.' };
    options.temperature = value;
  }
  if (settings.maxOutputTokens.trim()) {
    const value = Number(settings.maxOutputTokens);
    if (!Number.isInteger(value) || value < 1 || value > 65_536) return { options: null, error: 'Max answer length must be a whole number from 1 to 65,536.' };
    options.maxOutputTokens = value;
  }
  if (settings.retrievalOff) options.retrieval = { enabled: false };
  else if (settings.narrowTo.length) options.retrieval = { knowledgeBaseIds: settings.narrowTo };
  return { options, error: null };
}
