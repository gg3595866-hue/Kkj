import React, { useState } from 'react';
import { AppRequestState } from './types';
import { Button, Input, Textarea } from '@/components/ui/core';
import { useProbeRequest, ProxyRequestInputMethod } from '@workspace/api-client-react';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export function ProbeTab({ request, setRequest, setResponse }: { request: AppRequestState, setRequest: React.Dispatch<React.SetStateAction<AppRequestState>>, setResponse: (res: any) => void }) {
  const probeRequest = useProbeRequest();
  
  const [techniques, setTechniques] = useState({
    timing: true,
    partial: true,
    expect100: false
  });
  
  const [timingRounds, setTimingRounds] = useState(5);

  const handleRun = () => {
    const selectedTechniques = Object.entries(techniques)
      .filter(([_, v]) => v)
      .map(([k]) => k as "timing" | "partial" | "expect100");
      
    if (selectedTechniques.length === 0) return;

    const headersRecord: Record<string, string> = {};
    request.headers.forEach(h => {
      if (h.key.trim()) headersRecord[h.key.trim()] = h.value;
    });

    probeRequest.mutate({
      data: {
        url: request.url,
        method: request.method,
        headers: Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
        bearerToken: request.bearerToken || undefined,
        authHeaderName: request.authHeaderName || undefined,
        body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? request.body : undefined,
        techniques: selectedTechniques,
        timingRounds: techniques.timing ? timingRounds : undefined
      }
    }, {
      onSuccess: (res) => {
        setResponse({ ...res, _isProbe: true });
      },
      onError: (err) => {
        setResponse({ error: err, _isProbe: true });
      }
    });
  };

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
          <Button onClick={handleRun} disabled={probeRequest.isPending || Object.values(techniques).every(v => !v)} className="shrink-0 w-32">
            {probeRequest.isPending ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <><Play className="w-4 h-4 mr-1" /> Run Probe</>}
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
                checked={techniques.timing}
                onChange={e => setTechniques(prev => ({...prev, timing: e.target.checked}))}
              />
              <div>
                <div className="text-sm font-medium">Timing</div>
                <div className="text-xs text-muted-foreground">Sends N identical requests and records response time + body. Shows whether the server returns varying content across identical calls.</div>
                {techniques.timing && (
                  <div className="mt-2 flex items-center gap-2" onClick={e => e.preventDefault()}>
                    <span className="text-xs text-muted-foreground">Rounds:</span>
                    <Input 
                      type="number" 
                      min={1} 
                      max={20} 
                      value={timingRounds}
                      onChange={e => setTimingRounds(parseInt(e.target.value) || 1)}
                      className="w-20 h-7 text-xs"
                    />
                  </div>
                )}
              </div>
            </label>
            
            <label className="flex items-start gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                className="mt-1 accent-primary"
                checked={techniques.partial}
                onChange={e => setTechniques(prev => ({...prev, partial: e.target.checked}))}
              />
              <div>
                <div className="text-sm font-medium">Partial Read</div>
                <div className="text-xs text-muted-foreground">Sends full request, then aborts TCP read immediately after receiving response status and headers. Stream destroyed after 512 bytes.</div>
              </div>
            </label>
            
            <label className="flex items-start gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                className="mt-1 accent-primary"
                checked={techniques.expect100}
                onChange={e => setTechniques(prev => ({...prev, expect100: e.target.checked}))}
              />
              <div>
                <div className="text-sm font-medium">Expect-100</div>
                <div className="text-xs text-muted-foreground">Sends request headers with Expect: 100-continue but withholds the body.</div>
              </div>
            </label>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Authentication</h3>
          <div className="flex items-center gap-2">
            <div className="w-40 shrink-0">
              <Input 
                list="auth-header-names-probe"
                placeholder="Header Name"
                className="font-mono text-sm bg-muted text-muted-foreground h-9"
                value={request.authHeaderName}
                onChange={e => setRequest({...request, authHeaderName: e.target.value})}
                title="Auth Header Name"
              />
              <datalist id="auth-header-names-probe">
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
              placeholder="{&#10;  &quot;key&quot;: &quot;value&quot;&#10;}"
              value={request.body}
              onChange={e => setRequest({...request, body: e.target.value})}
            />
          </section>
        )}
      </div>
    </div>
  );
}