import React, { useState } from 'react';
import { Button, Input, Textarea } from '@/components/ui/core';
import { Shield, Play } from 'lucide-react';

export function ReconTab({ setResponse }: {
  setResponse: (res: any) => void;
}) {
  const [target, setTarget] = useState('');
  const [customSubs, setCustomSubs] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const customSubdomains = customSubs
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);

      const resp = await fetch('/api/recon/cloudfail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: target.trim(),
          ...(customSubdomains.length > 0 ? { customSubdomains } : {}),
        }),
      });
      const data = await resp.json();
      setResponse({ ...data, _isRecon: true });
    } catch (e: any) {
      setError(e.message ?? 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="p-4 border-b bg-card shrink-0 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            className="flex-1 font-mono text-sm"
            placeholder="melbet.mobi  or  https://melbet.mobi/any/path"
            value={target}
            onChange={e => setTarget(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleRun()}
          />
          <Button
            onClick={handleRun}
            disabled={loading || !target.trim()}
            className="shrink-0 w-36"
          >
            {loading
              ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <><Shield className="w-4 h-4 mr-1" /> CloudFail</>}
          </Button>
        </div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          Unmasks Cloudflare-protected origins via <span className="text-foreground font-medium">3 phases</span>:
          DNS record analysis · Crimeflare / HackerTarget / ViewDNS historical DB lookup · Subdomain brute-force ({' '}
          <span className="text-primary font-mono">~{customSubs.split('\n').filter(s => s.trim()).length || 220} subs</span>{' '}
          ). Origin IPs are verified by sending a direct request with the correct Host header.
        </div>
        {error && (
          <div className="text-xs text-destructive font-mono bg-destructive/10 border border-destructive/20 p-2 rounded">{error}</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Custom Subdomain Wordlist (optional)</h3>
          <div className="text-xs text-muted-foreground">
            One subdomain prefix per line (e.g. <span className="font-mono text-foreground">api</span>, <span className="font-mono text-foreground">dev</span>, <span className="font-mono text-foreground">origin</span>).
            Leave empty to use the built-in 220-entry list.
          </div>
          <Textarea
            className="font-mono text-xs resize-none min-h-[140px]"
            placeholder={"api\ndev\nstaging\norigin\ndirect\nbackend"}
            value={customSubs}
            onChange={e => setCustomSubs(e.target.value)}
          />
        </section>

        <section className="space-y-2 border border-border/40 rounded-md p-3">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Play className="w-3 h-3" /> How CloudFail works
          </h3>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <span className="text-primary font-mono font-bold shrink-0">Phase 1</span>
              <span><span className="text-foreground">DNS analysis</span> — resolves A/MX/TXT records and checks each IP against Cloudflare's published CIDR ranges. Any non-CF IP in a DNS record is a direct leak.</span>
            </div>
            <div className="flex gap-2">
              <span className="text-primary font-mono font-bold shrink-0">Phase 2</span>
              <span><span className="text-foreground">Historical DB lookup</span> — queries Crimeflare.org, HackerTarget DNS history, and ViewDNS IP history for IPs the target server used before moving behind Cloudflare.</span>
            </div>
            <div className="flex gap-2">
              <span className="text-primary font-mono font-bold shrink-0">Phase 3</span>
              <span><span className="text-foreground">Subdomain brute-force</span> — resolves 220+ common subdomains in parallel. Forgotten dev/staging/internal subs often bypass Cloudflare and point directly to the origin server.</span>
            </div>
            <div className="flex gap-2">
              <span className="text-green-400 font-mono font-bold shrink-0">Verify</span>
              <span><span className="text-foreground">IP verification</span> — sends a direct HTTP request to each candidate IP with the correct <span className="font-mono">Host:</span> header. Confirmed hits mean Cloudflare is completely bypassed for that IP.</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
