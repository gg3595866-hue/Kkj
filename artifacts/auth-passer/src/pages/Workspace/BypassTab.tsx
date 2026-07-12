import React, { useState } from 'react';
import { AppRequestState } from './types';
import { Button, Input, Textarea } from '@/components/ui/core';
import { useBypassProxy, ProxyRequestInputMethod } from '@workspace/api-client-react';
import { Play } from 'lucide-react';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export function BypassTab({ request, setRequest, setResponse }: { request: AppRequestState, setRequest: React.Dispatch<React.SetStateAction<AppRequestState>>, setResponse: (res: any) => void }) {
  const bypassProxy = useBypassProxy();
  
  const [techniques, setTechniques] = useState({
    dns: true,
    portscan: true,
    directip: true,
    hostswap: false
  });
  
  const [extraPortsStr, setExtraPortsStr] = useState('');

  const handleRun = () => {
    const selectedTechniques = Object.entries(techniques)
      .filter(([_, v]) => v)
      .map(([k]) => k as "dns" | "portscan" | "directip" | "hostswap");
      
    if (selectedTechniques.length === 0) return;

    const headersRecord: Record<string, string> = {};
    request.headers.forEach(h => {
      if (h.key.trim()) headersRecord[h.key.trim()] = h.value;
    });

    let extraPorts: number[] | undefined = undefined;
    if (techniques.portscan && extraPortsStr.trim()) {
      extraPorts = extraPortsStr.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n > 0 && n <= 65535);
    }

    bypassProxy.mutate({
      data: {
        url: request.url,
        method: request.method,
        headers: Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
        bearerToken: request.bearerToken || undefined,
        authHeaderName: request.authHeaderName || undefined,
        body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? request.body : undefined,
        techniques: selectedTechniques,
        extraPorts: extraPorts && extraPorts.length > 0 ? extraPorts : undefined
      }
    }, {
      onSuccess: (res) => {
        setResponse({ ...res, _isBypass: true });
      },
      onError: (err) => {
        setResponse({ error: err, _isBypass: true });
      }
    });
  };

  const isScanning = bypassProxy.isPending && techniques.portscan;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="p-4 border-b bg-card shrink-0 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <select 
            className="h-9 rounded-md border border-border bg-input px-3 py-1 text-sm text-primary focus:outline-none focus:border-primary font-mono font-bold w-28 shrink-0 appearance-none text-center"
            value={request.method}
            onChange={e => setRequest({...request, method: e.target.value as ProxyRequestInputMethod})}
          >
            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <Input 
            className="flex-1 font-mono text-sm"
            placeholder="https://api.example.com/v1/resource"
            value={request.url}
            onChange={e => setRequest({...request, url: e.target.value})}
            onKeyDown={e => e.key === 'Enter' && handleRun()}
          />
          <Button onClick={handleRun} disabled={bypassProxy.isPending || Object.values(techniques).every(v => !v)} className="shrink-0 w-40">
            {bypassProxy.isPending ? (
              <>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                {isScanning ? "Scanning ports…" : "Bypassing…"}
              </>
            ) : (
              <><Play className="w-4 h-4 mr-1" /> Run Bypass</>
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section className="space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Techniques</h3>
          
          <div className="space-y-3 bg-muted/10 p-3 rounded-md border border-border/50">
            <label className="flex items-start gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                className="mt-1 accent-primary"
                checked={techniques.dns}
                onChange={e => setTechniques(prev => ({...prev, dns: e.target.checked}))}
              />
              <div>
                <div className="text-sm font-medium">DNS Resolution</div>
                <div className="text-xs text-muted-foreground">Resolves A/AAAA records, CNAME chain, NS records, and attempts to detect CDN/proxy fingerprint from the target.</div>
              </div>
            </label>
            
            <label className="flex items-start gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                className="mt-1 accent-primary"
                checked={techniques.portscan}
                onChange={e => setTechniques(prev => ({...prev, portscan: e.target.checked}))}
              />
              <div className="w-full">
                <div className="text-sm font-medium">Port Scan</div>
                <div className="text-xs text-muted-foreground mb-2">TCP probes resolved IPs on common backend ports (e.g. 80, 443, 8080, 8443, etc.). Can take 10-20 seconds.</div>
                {techniques.portscan && (
                  <div className="flex flex-col gap-1 mt-2" onClick={e => e.preventDefault()}>
                    <span className="text-xs text-muted-foreground">Extra Ports (comma-separated):</span>
                    <Input 
                      placeholder="e.g. 3000, 8000, 9090"
                      value={extraPortsStr}
                      onChange={e => setExtraPortsStr(e.target.value)}
                      className="h-8 text-xs font-mono w-full max-w-sm"
                    />
                  </div>
                )}
              </div>
            </label>
            
            <label className="flex items-start gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                className="mt-1 accent-primary"
                checked={techniques.directip}
                onChange={e => setTechniques(prev => ({...prev, directip: e.target.checked}))}
              />
              <div>
                <div className="text-sm font-medium">Direct IP Request</div>
                <div className="text-xs text-muted-foreground">Sends the actual request to each open IP:port found, keeping the original Host header intact to bypass the front proxy.</div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                className="mt-1 accent-primary"
                checked={techniques.hostswap}
                onChange={e => setTechniques(prev => ({...prev, hostswap: e.target.checked}))}
              />
              <div>
                <div className="text-sm font-medium">Host Swap</div>
                <div className="text-xs text-muted-foreground">Tries alternative Host header values against the original URL to find different internal routing on the reverse proxy.</div>
              </div>
            </label>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Authentication</h3>
          <div className="flex items-center gap-2">
            <div className="w-40 shrink-0">
              <Input 
                list="auth-header-names-bypass"
                placeholder="Header Name"
                className="font-mono text-sm bg-muted text-muted-foreground h-9"
                value={request.authHeaderName}
                onChange={e => setRequest({...request, authHeaderName: e.target.value})}
                title="Auth Header Name"
              />
              <datalist id="auth-header-names-bypass">
                <option value="Authorization" />
                <option value="x-auth" />
                <option value="X-API-Key" />
                <option value="X-Token" />
              </datalist>
            </div>
            <Input 
              type="password"
              placeholder="Bearer Token (e.g. eyJhbGci...)"
              value={request.bearerToken}
              onChange={e => setRequest({...request, bearerToken: e.target.value})}
            />
          </div>
        </section>

        {['POST', 'PUT', 'PATCH'].includes(request.method) && (
          <section className="space-y-2 flex-1 flex flex-col min-h-[200px]">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Body</h3>
              <select 
                className="bg-transparent text-xs font-mono text-muted-foreground focus:outline-none focus:text-primary appearance-none cursor-pointer"
                value={request.contentType}
                onChange={e => setRequest({...request, contentType: e.target.value})}
              >
                <option value="application/json">application/json</option>
                <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                <option value="text/plain">text/plain</option>
              </select>
            </div>
            <Textarea 
              className="flex-1 font-mono text-xs resize-none"
              placeholder="{\n  &quot;key&quot;: &quot;value&quot;\n}"
              value={request.body}
              onChange={e => setRequest({...request, body: e.target.value})}
            />
          </section>
        )}
      </div>
    </div>
  );
}