import { Eye, EyeOff, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import Heading from '@/components/heading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { type AIProvider, useAIIntegration } from '@/hooks/use-ai-integration';
import { AI_PROVIDER_META } from '@/lib/ai-providers';

export default function AIIntegration() {
    const { config, saveConfig, clearConfig } = useAIIntegration();
    const [provider, setProvider] = useState<AIProvider>(
        config?.provider ?? 'openai',
    );
    const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
    const [showKey, setShowKey] = useState(false);
    const [saved, setSaved] = useState(false);

    const isDirty =
        provider !== config?.provider || apiKey !== (config?.apiKey ?? '');
    const canSave = apiKey.trim().length > 0 && isDirty;

    const handleSave = () => {
        if (!apiKey.trim()) return;
        saveConfig({ provider, apiKey: apiKey.trim() });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const handleClear = () => {
        clearConfig();
        setApiKey('');
        setProvider('openai');
    };

    const handleProviderChange = (value: AIProvider) => {
        setProvider(value);
        if (config?.provider === value) {
            setApiKey(config.apiKey);
        } else {
            setApiKey('');
        }
    };

    return (
        <section className="px-4 py-6 sm:px-6">
            <Heading
                title="AI integration"
                description="Add your own API key to unlock AI-assisted writing in the composer. Your key is stored only in this browser and never sent to our servers."
            />

            <div className="max-w-sm space-y-4">
                <div className="space-y-1.5">
                    <Label htmlFor="ai-provider">Provider</Label>
                    <Select
                        value={provider}
                        onValueChange={(v) =>
                            handleProviderChange(v as AIProvider)
                        }
                    >
                        <SelectTrigger id="ai-provider" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(
                                Object.keys(AI_PROVIDER_META) as AIProvider[]
                            ).map((key) => (
                                <SelectItem key={key} value={key}>
                                    {AI_PROVIDER_META[key].label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="ai-api-key">API key</Label>
                    <div className="relative">
                        <Input
                            id="ai-api-key"
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSave();
                            }}
                            placeholder={AI_PROVIDER_META[provider].placeholder}
                            autoComplete="off"
                            spellCheck={false}
                            className="pr-10 font-mono text-sm"
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey((v) => !v)}
                            aria-label={
                                showKey ? 'Hide API key' : 'Show API key'
                            }
                            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                            {showKey ? (
                                <EyeOff className="size-4" />
                            ) : (
                                <Eye className="size-4" />
                            )}
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        onClick={handleSave}
                        disabled={!canSave}
                    >
                        <KeyRound />
                        {saved ? 'Saved!' : 'Save key'}
                    </Button>
                    {config && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleClear}
                        >
                            <Trash2 />
                            Remove
                        </Button>
                    )}
                </div>

                {config && (
                    <div className="flex items-center gap-1.5 text-sm">
                        <span className="size-2 rounded-full bg-green-500" />
                        <span className="text-muted-foreground">
                            {AI_PROVIDER_META[config.provider].label} key active
                        </span>
                    </div>
                )}

                <div className="flex items-start gap-2 rounded-md border p-3 text-xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground/50" />
                    <p>
                        Stored only in your browser&apos;s local storage. AI
                        calls go directly from your browser to the provider
                        &mdash; your key never reaches our servers.
                    </p>
                </div>
            </div>
        </section>
    );
}
