import { useSyncExternalStore } from 'react';

export type AIProvider = 'openai' | 'anthropic' | 'grok';

export interface AIConfig {
    provider: AIProvider;
    apiKey: string;
}

export type UseAIIntegrationReturn = {
    readonly config: AIConfig | null;
    readonly saveConfig: (config: AIConfig) => void;
    readonly clearConfig: () => void;
};

const STORAGE_KEY = 'ai_integration';

const listeners = new Set<() => void>();

function getStoredConfig(): AIConfig | null {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        return stored ? (JSON.parse(stored) as AIConfig) : null;
    } catch {
        return null;
    }
}

let currentConfig: AIConfig | null = getStoredConfig();

const subscribe = (callback: () => void) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
};

const notify = (): void => listeners.forEach((listener) => listener());

export function useAIIntegration(): UseAIIntegrationReturn {
    const config = useSyncExternalStore(
        subscribe,
        () => currentConfig,
        () => null,
    );

    const saveConfig = (newConfig: AIConfig): void => {
        currentConfig = newConfig;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
        } catch {
            // localStorage unavailable (private browsing, storage full, etc.)
        }
        notify();
    };

    const clearConfig = (): void => {
        currentConfig = null;
        try {
            window.localStorage.removeItem(STORAGE_KEY);
        } catch {
            // localStorage unavailable
        }
        notify();
    };

    return { config, saveConfig, clearConfig } as const;
}
