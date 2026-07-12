import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent, Badge, Input, Button } from '@/components/ui/core';
import type { ProxyResponse } from '@workspace/api-client-react';

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  http_response: { label: 'HTTP', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  network_error: { label: 'NETWORK ERROR', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  tls_error: { label: 'TLS ERROR', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  timeout: { label: 'TIMEOUT', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  dns_error: { label: 'DNS ERROR', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  too_many_redirects: { label: 'TOO MANY REDIRECTS', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function HeadersTable({ headers }: { headers: Record<string, string | string[]> }) {
  const pairs: [string, string][] = [];
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) {
      v.forEach(val => pairs.push([k, val]));
    } else {
      pairs.push([k, v]);
    }
  }
  if (pairs.length === 0) return <div className="text-xs text-muted-foreground font-mono italic">No headers</div>;
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs font-mono">
      {pairs.map(([k, v], i) => (
        <React.Fragment key={i}>
          <div className="text-primary/80 whitespace-nowrap">{k}:</div>
          <div className="text-foreground break-all">{v}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

function HopChain({ hops }: { hops: NonNullable<ProxyResponse['hops']> }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  if (hops.length === 0) return null;
  return (
    <div className="border-b shrink-0 bg-[#0a0a0c]">
      <div className="px-4 py-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          {hops.length === 1 ? '1 hop' : `${hops.length} hops`}
        </span>
      </div>
      <div className="px-4 pb-3 space-y-1">
        {hops.map((hop, i) => {
          const isFinal = i === hops.length - 1;
          const isOpen = expanded === i;
          const statusColor = hop.status >= 500 ? 'text-red-400' : hop.status >= 400 ? 'text-orange-400' : hop.status >= 300 ? 'text-yellow-400' : 'text-emerald-400';
          return (
            <div key={i} className="border border-border/40 rounded bg-background/40">
              <button
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
                onClick={() => setExpanded(isOpen ? null : i)}
              >
                <span className="text-[10px] text-muted-foreground font-mono w-4 shrink-0">{i + 1}</span>
                <span className={`font-mono text-xs font-bold shrink-0 ${statusColor}`}>{hop.status}</span>
                <span className="text-muted-foreground font-mono text-xs shrink-0">{hop.statusText}</span>
                <span className="font-mono text-xs text-foreground/70 truncate flex-1">{hop.url}</span>
                <span className="font-mono text-xs text-muted-foreground shrink-0">{hop.durationMs}ms</span>
                {isFinal && <span className="text-[9px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded shrink-0">FINAL</span>}
                <span className="text-muted-foreground text-xs">{isOpen ? '▲' : '▼'}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-border/30">
                  <HeadersTable headers={hop.headers} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ErrorPanel({ response }: { response: ProxyResponse }) {
  const ed = response.errorDetails;
  const outcomeInfo = OUTCOME_LABELS[response.transportOutcome] ?? { label: response.transportOutcome.toUpperCase(), color: 'bg-red-500/20 text-red-400 border-red-500/30' };
  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-mono font-bold ${outcomeInfo.color}`}>
        {outcomeInfo.label}
      </div>
      {ed && (
        <div className="space-y-3">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs font-mono">
            {ed.errorCode && (
              <>
                <span className="text-muted-foreground">error code</span>
                <span className="text-red-400">{ed.errorCode}</span>
              </>
            )}
            {ed.syscall && (
              <>
                <span className="text-muted-foreground">syscall</span>
                <span className="text-foreground">{ed.syscall}</span>
              </>
            )}
            <span className="text-muted-foreground">message</span>
            <span className="text-foreground break-all">{ed.errorMessage}</span>
          </div>
          {ed.causeChain.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Cause Chain</div>
              <div className="space-y-1.5">
                {ed.causeChain.map((cause, i) => (
                  <div key={i} className="pl-3 border-l-2 border-border/60 text-xs font-mono space-y-0.5">
                    {cause.code && <div className="text-orange-400">{cause.code}{cause.syscall ? ` (${cause.syscall})` : ''}</div>}
                    <div className="text-foreground/80 break-all">{cause.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {response.hops && response.hops.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Hops Before Error</div>
          <HopChain hops={response.hops} />
        </div>
      )}
    </div>
  );
}

export function ResponsePanel({ response }: { response: ProxyResponse | null }) {
  const [iframeInput, setIframeInput] = useState('');
  const [iframeSrc, setIframeSrc] = useState('');
  const [bodyView, setBodyView] = useState<'pretty' | 'raw'>('pretty');

  const isError = response && response.transportOutcome !== 'http_response';
  const outcomeInfo = response ? (OUTCOME_LABELS[response.transportOutcome] ?? { label: response.transportOutcome, color: '' }) : null;

  let formattedBody = response?.body ?? '';
  let bodyIsPrettyJson = false;
  if (formattedBody && bodyView === 'pretty') {
    try {
      formattedBody = JSON.stringify(JSON.parse(formattedBody), null, 2);
      bodyIsPrettyJson = true;
    } catch {
      // not json
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0c0c0e] overflow-hidden">
      <Tabs defaultValue="response" className="flex flex-col h-full">
        <div className="h-14 border-b flex items-center px-4 shrink-0 justify-between bg-card">
          <TabsList className="bg-background">
            <TabsTrigger value="response">Response</TabsTrigger>
            <TabsTrigger value="iframe">Iframe Viewer</TabsTrigger>
          </TabsList>

          {response && (
            <div className="flex items-center gap-2 text-sm flex-wrap justify-end">
              {outcomeInfo && (
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${outcomeInfo.color}`}>
                  {outcomeInfo.label}
                </span>
              )}
              {response.transportOutcome === 'http_response' && response.status != null && (
                <Badge variant={response.status < 400 ? 'success' : 'error'}>
                  {response.status} {response.statusText}
                </Badge>
              )}
              <span className="text-muted-foreground font-mono text-xs bg-muted/30 px-2 py-0.5 rounded border border-border/50">
                {response.durationMs}ms
              </span>
              {response.bodySizeBytes != null && response.bodySizeBytes > 0 && (
                <span className={`font-mono text-xs px-2 py-0.5 rounded border ${response.bodyTruncated ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' : 'bg-muted/30 text-muted-foreground border-border/50'}`}>
                  {formatBytes(response.bodySizeBytes)}{response.bodyTruncated ? ' (truncated at 10 MB)' : ''}
                </span>
              )}
            </div>
          )}
        </div>

        <TabsContent value="response" className="flex-1 overflow-hidden m-0 data-[state=active]:flex flex-col bg-background">
          {!response ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm font-mono bg-background">
              Awaiting request...
            </div>
          ) : isError ? (
            <ErrorPanel response={response} />
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Redirect hop chain */}
              {response.hops && response.hops.length > 1 && (
                <HopChain hops={response.hops} />
              )}

              {/* Response headers */}
              <div className="p-4 border-b shrink-0 max-h-[30%] overflow-auto bg-[#0a0a0c]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Response Headers</h3>
                </div>
                <HeadersTable headers={response.headers ?? {}} />
              </div>

              {/* Body */}
              <div className="flex-1 overflow-auto bg-background">
                {bodyIsPrettyJson && (
                  <div className="flex items-center gap-1 px-4 pt-3 pb-1">
                    <button
                      onClick={() => setBodyView('pretty')}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border ${bodyView === 'pretty' ? 'border-primary/50 text-primary bg-primary/10' : 'border-border/40 text-muted-foreground hover:border-border'}`}
                    >
                      Pretty
                    </button>
                    <button
                      onClick={() => setBodyView('raw')}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border ${bodyView === 'raw' ? 'border-primary/50 text-primary bg-primary/10' : 'border-border/40 text-muted-foreground hover:border-border'}`}
                    >
                      Raw
                    </button>
                  </div>
                )}
                <pre className="font-mono text-[13px] leading-relaxed text-foreground whitespace-pre-wrap p-4 pt-2">
                  {formattedBody || <span className="text-muted-foreground italic">(empty body)</span>}
                </pre>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="iframe" className="flex-1 overflow-hidden m-0 data-[state=active]:flex flex-col bg-card">
          <div className="p-2 border-b flex gap-2 shrink-0 bg-background">
            <Input
              placeholder="https://example.com"
              value={iframeInput}
              onChange={e => setIframeInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setIframeSrc(iframeInput)}
              className="font-mono"
            />
            <Button onClick={() => setIframeSrc(iframeInput)}>Load</Button>
          </div>
          <div className="flex-1 bg-white relative">
            {iframeSrc ? (
              <iframe
                src={iframeSrc}
                className="absolute inset-0 w-full h-full border-0 bg-white"
                title="Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm font-mono bg-gray-50">
                Enter a URL to load in the iframe
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
