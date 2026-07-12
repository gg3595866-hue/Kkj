import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Server, Globe, Activity, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BypassOutput } from '@workspace/api-client-react';

interface TypedBypassOutputDns {
  hostname?: string;
  ipv4?: string[];
  ipv6?: string[];
  cname?: string[];
  ns?: string[];
  mx?: string[];
  proxyFingerprint?: string;
  error?: string;
}

interface TypedBypassOutputPortscan {
  scannedPorts?: number[];
  results?: Record<string, Array<{ port: number; latencyMs: number }>>;
  note?: string;
}

interface TypedBypassOutputDirectip {
  note?: string;
  results?: Array<{
    target: string;
    status: number;
    statusText: string;
    durationMs: number;
    headers: Record<string, string>;
    body: string;
    error?: string | null;
    backendFingerprint?: string;
  }>;
}

interface TypedBypassOutputHostswap {
  note?: string;
  results?: Array<{
    altHost: string;
    status: number;
    statusText: string;
    durationMs: number;
    headers: Record<string, string>;
    body: string;
    error?: string | null;
  }>;
}

interface TypedBypassOutput {
  dns?: TypedBypassOutputDns;
  portscan?: TypedBypassOutputPortscan;
  directip?: TypedBypassOutputDirectip;
  hostswap?: TypedBypassOutputHostswap;
}

export function BypassResults({ response }: { response: any }) {
  if (response.error) {
    return (
      <div className="p-4 bg-background h-full text-red-500 font-mono text-sm overflow-auto">
        Error: {JSON.stringify(response.error, null, 2)}
      </div>
    );
  }

  const data = response as TypedBypassOutput;
  const proxyFingerprint = data.dns?.proxyFingerprint || '';

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden text-sm border-l border-border">
      <div className="p-4 border-b bg-card shrink-0">
        <h2 className="font-mono font-bold text-primary flex items-center gap-2">
          Bypass Results
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {data.dns && (
          <Section title="DNS & Fingerprint" icon={<Globe className="w-4 h-4" />}>
            <div className="font-mono bg-muted/10 border border-border/50 rounded-md p-3 space-y-2 text-xs">
              <KV label="Hostname" value={data.dns.hostname} />
              <KV label="IPv4" value={data.dns.ipv4?.join(', ')} />
              <KV label="IPv6" value={data.dns.ipv6?.join(', ')} />
              <KV label="CNAME" value={data.dns.cname?.join(', ')} />
              <KV label="NS" value={data.dns.ns?.join(', ')} />
              <KV label="MX" value={data.dns.mx?.join(', ')} />
              <div className="pt-2 mt-2 border-t border-border/50 flex gap-4">
                <span className="text-muted-foreground w-24 sm:w-32 shrink-0">Proxy Fingerprint:</span>
                <span className={cn(
                  "font-bold",
                  data.dns.proxyFingerprint?.toLowerCase().includes('angie') ? "text-amber-500" : "text-primary"
                )}>
                  {data.dns.proxyFingerprint || 'Unknown'}
                </span>
              </div>
              {data.dns.error && <div className="text-red-500 mt-2">Error: {data.dns.error}</div>}
            </div>
          </Section>
        )}

        {data.portscan && (
          <Section title="Port Scan" icon={<Activity className="w-4 h-4" />}>
            <div className="space-y-4">
              <div className="text-muted-foreground text-xs">{data.portscan.note}</div>
              {Object.entries(data.portscan.results || {}).map(([ip, ports]) => (
                <div key={ip} className="border border-border/50 rounded-md overflow-hidden bg-muted/5">
                  <div className="px-3 py-2 bg-muted/20 border-b border-border/50 font-mono font-bold text-xs">
                    {ip}
                  </div>
                  {ports.length === 0 ? (
                    <div className="px-3 py-2 text-muted-foreground font-mono text-xs">
                      No open ports found on this IP
                    </div>
                  ) : (
                    <table className="w-full text-left font-mono text-xs">
                      <thead>
                        <tr className="border-b border-border/50">
                          <th className="px-3 py-2 text-muted-foreground font-medium">Port</th>
                          <th className="px-3 py-2 text-muted-foreground font-medium">Latency</th>
                          <th className="px-3 py-2 text-muted-foreground font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ports.map((p, i) => (
                          <tr key={i} className="border-b border-border/10 last:border-0">
                            <td className="px-3 py-2">{p.port}</td>
                            <td className="px-3 py-2">{p.latencyMs}ms</td>
                            <td className="px-3 py-2">
                              <span className="text-green-500 font-bold border border-green-500/30 bg-green-500/10 px-1 py-0.5 rounded text-[10px]">OPEN</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {data.directip && (
          <Section title="Direct IP Probes" icon={<Server className="w-4 h-4" />}>
            <div className="space-y-4">
              <div className="text-muted-foreground text-xs">{data.directip.note}</div>
              {data.directip.results?.map((res, i) => (
                <DirectIpCard key={i} result={res} proxyFingerprint={proxyFingerprint} />
              ))}
              {(!data.directip.results || data.directip.results.length === 0) && (
                <div className="text-muted-foreground text-xs">No direct IP results.</div>
              )}
            </div>
          </Section>
        )}

        {data.hostswap && (
          <Section title="Host Swap" icon={<Repeat className="w-4 h-4" />}>
            <div className="space-y-4">
              <div className="text-muted-foreground text-xs">{data.hostswap.note}</div>
              <div className="border border-border/50 rounded-md overflow-hidden bg-muted/5">
                <table className="w-full text-left font-mono text-xs block overflow-x-auto">
                  <thead className="w-full table border-b border-border/50 bg-muted/20">
                    <tr>
                      <th className="px-3 py-2 text-muted-foreground font-medium w-1/3">Alt Host</th>
                      <th className="px-3 py-2 text-muted-foreground font-medium">Status</th>
                      <th className="px-3 py-2 text-muted-foreground font-medium">Duration</th>
                      <th className="px-3 py-2 text-muted-foreground font-medium w-1/3">Note</th>
                    </tr>
                  </thead>
                  <tbody className="w-full table">
                    {data.hostswap.results?.map((res, i) => (
                      <tr key={i} className="border-b border-border/10 last:border-0">
                        <td className="px-3 py-2 break-all">{res.altHost}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <StatusBadge status={res.status} statusText={res.statusText} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{res.durationMs}ms</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {res.error ? (
                            <span className="text-red-500 break-all">{res.error}</span>
                          ) : (
                            res.body ? "Body returned" : ""
                          )}
                        </td>
                      </tr>
                    ))}
                    {(!data.hostswap.results || data.hostswap.results.length === 0) && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                          No host swap results.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-2">
      <button 
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors w-full text-left"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {icon}
        {title}
      </button>
      {open && <div className="pl-6 pt-2">{children}</div>}
    </div>
  );
}

function KV({ label, value }: { label: string; value?: string | number | null }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4 break-all">
      <span className="text-muted-foreground w-24 sm:w-32 shrink-0">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

function StatusBadge({ status, statusText }: { status: number; statusText?: string }) {
  let color = "text-muted-foreground border-border";
  if (status >= 200 && status < 300) color = "text-green-500 border-green-500/30 bg-green-500/10";
  else if (status >= 300 && status < 400) color = "text-yellow-500 border-yellow-500/30 bg-yellow-500/10";
  else if (status >= 400 || status === 0) color = "text-red-500 border-red-500/30 bg-red-500/10";

  return (
    <span className={cn("px-2 py-0.5 rounded border font-bold inline-flex items-center text-[10px]", color)}>
      {status === 0 ? 'ERR' : status} {statusText && statusText.length > 0 ? statusText : ''}
    </span>
  );
}

function DirectIpCard({ result, proxyFingerprint }: { result: any; proxyFingerprint: string }) {
  const [open, setOpen] = useState(false);
  
  const isDifferentFingerprint = result.backendFingerprint && 
    result.backendFingerprint !== proxyFingerprint;

  return (
    <div className="border border-border/50 rounded-md overflow-hidden bg-muted/5 font-mono text-xs">
      <div className="px-3 py-2 bg-muted/20 border-b border-border/50 flex flex-wrap gap-2 sm:gap-4 items-center justify-between">
        <div className="font-bold flex items-center gap-2 break-all">
          {result.target}
        </div>
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          {result.backendFingerprint && (
            <span className={cn("px-2 py-0.5 rounded border", isDifferentFingerprint ? "text-amber-500 border-amber-500/30 bg-amber-500/10" : "text-muted-foreground border-border/50")}>
              {result.backendFingerprint}
            </span>
          )}
          <span className="text-muted-foreground">{result.durationMs}ms</span>
          <StatusBadge status={result.status} statusText={result.statusText} />
        </div>
      </div>
      
      {result.error && (
        <div className="px-3 py-2 text-red-500 border-b border-border/50 bg-red-500/5 break-all">
          {result.error}
        </div>
      )}

      <button 
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-1.5 text-left text-muted-foreground hover:bg-muted/10 hover:text-primary transition-colors flex items-center gap-2 text-[11px]"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {open ? "Hide Details" : "Show Details"}
      </button>

      {open && (
        <div className="border-t border-border/50 divide-y divide-border/50">
          {result.headers && Object.keys(result.headers).length > 0 && (
            <div className="px-3 py-2 overflow-x-auto">
              <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">Headers</div>
              <table className="w-full text-left">
                <tbody>
                  {Object.entries(result.headers).map(([k, v]) => (
                    <tr key={k}>
                      <td className="pr-4 py-0.5 text-muted-foreground whitespace-nowrap">{k}:</td>
                      <td className="py-0.5 break-all">{(v as string)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.body && (
            <div className="px-3 py-2">
              <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">Body (first 2000 chars)</div>
              <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                {(result.body as string).slice(0, 2000)}
                {(result.body as string).length > 2000 && <span className="text-muted-foreground">...</span>}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}