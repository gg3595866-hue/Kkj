import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Shield, ChevronDown, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/core';

function Badge({ children, color = 'default' }: { children: React.ReactNode; color?: 'green' | 'red' | 'yellow' | 'blue' | 'default' }) {
  const cls = {
    green: 'bg-green-500/10 text-green-400 border-green-500/30',
    red: 'bg-red-500/10 text-red-400 border-red-500/30',
    yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    default: 'bg-muted/20 text-muted-foreground border-border/40',
  }[color];
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded border font-mono text-[10px] font-bold', cls)}>
      {children}
    </span>
  );
}

function IpCard({ ip, confirmed, statusCode, serverHeader, label }: {
  ip: string; confirmed: boolean; statusCode: number; serverHeader?: string; label?: string;
}) {
  const copy = () => navigator.clipboard?.writeText(ip).catch(() => { });
  return (
    <div className={cn(
      "border rounded-md p-3 font-mono text-sm space-y-2",
      confirmed ? "border-green-500/40 bg-green-500/5" : "border-border/50 bg-muted/5"
    )}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={cn("text-lg font-bold", confirmed ? "text-green-400" : "text-foreground")}>{ip}</span>
          {label && <span className="text-[10px] text-muted-foreground">{label}</span>}
        </div>
        <div className="flex items-center gap-2">
          {confirmed
            ? <Badge color="green">✓ CONFIRMED — CF bypassed</Badge>
            : <Badge color="yellow">unverified</Badge>
          }
          {statusCode > 0 && <Badge color="default">{statusCode}</Badge>}
          <button onClick={copy} title="Copy IP" className="text-muted-foreground hover:text-foreground transition-colors">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <a
            href={`https://www.shodan.io/host/${ip}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Look up on Shodan"
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
      {serverHeader && (
        <div className="text-[11px]">
          <span className="text-muted-foreground">Server: </span>
          <span className="text-yellow-300">{serverHeader}</span>
        </div>
      )}
      {confirmed && (
        <div className="text-[10px] text-green-400 leading-snug">
          ⚡ Direct requests to this IP bypass Cloudflare WAF, DDoS mitigation, and rate limiting.
          Use with <span className="font-bold">Host: {'{domain}'}</span> header.
        </div>
      )}
    </div>
  );
}

export function ReconResults({ response }: { response: any }) {
  const [phase3Open, setPhase3Open] = useState(false);
  const [showAllSubs, setShowAllSubs] = useState(false);

  if (!response) return null;

  const { domain, durationMs, behindCloudflare, phase1, phase2, phase3, candidateIps } = response;

  const confirmedIps = (candidateIps ?? []).filter((c: any) => c.confirmed);
  const nonCfSubdomains = (phase3?.subdomains ?? []).filter((s: any) => s.nonCfIps.length > 0);
  const cfSubdomains = (phase3?.subdomains ?? []).filter((s: any) => s.nonCfIps.length === 0);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden text-sm border-l border-border">
      {/* Header */}
      <div className="p-4 border-b bg-card shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-mono font-bold text-primary flex items-center gap-2">
            <Shield className="w-4 h-4" /> CloudFail — {domain}
          </h2>
          <div className="flex items-center gap-2">
            {behindCloudflare
              ? <Badge color="yellow">Behind Cloudflare</Badge>
              : <Badge color="green">Not behind Cloudflare</Badge>
            }
            <span className="text-[11px] text-muted-foreground font-mono">{(durationMs / 1000).toFixed(1)}s</span>
          </div>
        </div>
        {confirmedIps.length > 0 && (
          <div className="mt-2 text-xs text-green-400 font-semibold">
            🎯 {confirmedIps.length} confirmed origin IP{confirmedIps.length > 1 ? 's' : ''} — Cloudflare bypassed
          </div>
        )}
        {(candidateIps ?? []).length > 0 && confirmedIps.length === 0 && (
          <div className="mt-2 text-xs text-yellow-400">
            {(candidateIps ?? []).length} candidate IP{(candidateIps ?? []).length > 1 ? 's' : ''} found — verification failed (server may not respond to direct connections)
          </div>
        )}
        {(candidateIps ?? []).length === 0 && (
          <div className="mt-2 text-xs text-muted-foreground">No candidate IPs discovered in this scan.</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* Candidate IPs */}
        {(candidateIps ?? []).length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Origin IP Candidates</h3>
            <div className="space-y-2">
              {(candidateIps ?? []).map((c: any, i: number) => (
                <IpCard key={i} ip={c.ip} confirmed={c.confirmed} statusCode={c.statusCode} serverHeader={c.serverHeader} />
              ))}
            </div>
          </section>
        )}

        {/* Phase 1 — DNS */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            Phase 1 — DNS Analysis
            <Badge color={phase1?.behindCf ? 'yellow' : 'green'}>
              {phase1?.behindCf ? 'All IPs are Cloudflare' : 'Non-CF IPs found'}
            </Badge>
          </h3>
          {phase1?.ips?.length > 0 && (
            <div className="border border-border/50 rounded-md overflow-hidden">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-3 py-1.5 text-muted-foreground">IP Address</th>
                    <th className="px-3 py-1.5 text-muted-foreground">Source</th>
                    <th className="px-3 py-1.5 text-muted-foreground">Cloudflare?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {phase1.ips.map((e: any, i: number) => (
                    <tr key={i} className={cn("hover:bg-muted/10", !e.isCloudflare && "bg-green-500/5")}>
                      <td className={cn("px-3 py-1.5 font-bold", e.isCloudflare ? "text-muted-foreground" : "text-green-400")}>{e.ip}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{e.source}</td>
                      <td className="px-3 py-1.5">
                        {e.isCloudflare ? <Badge color="yellow">CF edge</Badge> : <Badge color="green">Direct IP</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {phase1?.txtRecords?.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">TXT Records</div>
              {phase1.txtRecords.map((r: string, i: number) => (
                <div key={i} className="font-mono text-[11px] text-muted-foreground bg-muted/10 px-2 py-1 rounded break-all">{r}</div>
              ))}
            </div>
          )}
        </section>

        {/* Phase 2 — Historical DB */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            Phase 2 — Historical Database Lookup
            <Badge color={phase2?.length > 0 ? 'green' : 'default'}>{phase2?.length ?? 0} hits</Badge>
          </h3>
          {(phase2?.length ?? 0) === 0 ? (
            <div className="text-xs text-muted-foreground">No historical IPs found in Crimeflare / HackerTarget / ViewDNS databases.</div>
          ) : (
            <div className="space-y-2">
              {phase2.map((e: any, i: number) => (
                <div key={i} className="border border-green-500/30 bg-green-500/5 rounded-md px-3 py-2 font-mono text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-green-400 font-bold text-sm">{e.ip}</span>
                    <Badge color="blue">{e.source}</Badge>
                  </div>
                  {e.evidence && (
                    <div className="text-muted-foreground text-[10px] mt-1 break-all">{e.evidence.slice(0, 150)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Phase 3 — Subdomains */}
        <section className="space-y-2">
          <button
            onClick={() => setPhase3Open(v => !v)}
            className="w-full flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          >
            {phase3Open
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronRight className="w-3 h-3" />}
            Phase 3 — Subdomain Brute-Force
            <span className="ml-1">
              <Badge color={nonCfSubdomains.length > 0 ? 'green' : 'default'}>
                {phase3?.found ?? 0} resolved · {nonCfSubdomains.length} non-CF
              </Badge>
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto normal-case font-normal">
              {phase3?.totalProbed} probed
            </span>
          </button>

          {phase3Open && (
            <div className="space-y-3">
              {nonCfSubdomains.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">
                    ⚡ Non-Cloudflare subdomains — potential origin IPs
                  </div>
                  {nonCfSubdomains.map((s: any, i: number) => (
                    <div key={i} className="border border-green-500/30 bg-green-500/5 rounded px-3 py-2 font-mono text-xs flex flex-wrap items-center gap-3">
                      <span className="text-green-400 font-bold">{s.subdomain}</span>
                      <div className="flex gap-1 flex-wrap">
                        {s.nonCfIps.map((ip: string, j: number) => (
                          <span key={j} className="text-green-300">{ip}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {cfSubdomains.length > 0 && (
                <div className="space-y-1">
                  <button
                    onClick={() => setShowAllSubs(v => !v)}
                    className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground font-semibold flex items-center gap-1"
                  >
                    {showAllSubs ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {cfSubdomains.length} Cloudflare-routed subdomains (no bypass value)
                  </button>
                  {showAllSubs && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {cfSubdomains.map((s: any, i: number) => (
                        <div key={i} className="font-mono text-[10px] text-muted-foreground flex justify-between">
                          <span>{s.subdomain}</span>
                          <span className="text-muted-foreground/60">{s.ips[0]}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(phase3?.found ?? 0) === 0 && (
                <div className="text-xs text-muted-foreground">No subdomains resolved.</div>
              )}
            </div>
          )}
        </section>

        {/* Next steps */}
        {(candidateIps ?? []).length > 0 && (
          <section className="border border-border/40 rounded-md p-3 space-y-2">
            <h3 className="text-xs font-semibold text-foreground">Next Steps</h3>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              {confirmedIps.map((c: any) => (
                <div key={c.ip} className="space-y-1">
                  <div>1. In Builder tab, change the URL to <span className="font-mono text-primary">https://{c.ip}/...</span> using the same path</div>
                  <div>2. Add header <span className="font-mono text-primary">Host: {domain}</span> to route correctly</div>
                  <div>3. Your requests now bypass Cloudflare WAF/DDoS/rate limits completely</div>
                  <div>4. Use Scan tab with the direct IP as base URL to find admin/internal paths hidden behind CF</div>
                </div>
              ))}
              {confirmedIps.length === 0 && (
                <div>
                  Try the candidate IPs manually: <span className="font-mono text-primary">curl -H "Host: {domain}" https://CANDIDATE_IP/</span>
                  — if you get the site content, Cloudflare is bypassed.
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
