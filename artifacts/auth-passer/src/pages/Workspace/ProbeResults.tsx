import React, { useState } from 'react';
import { Badge } from '@/components/ui/core';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function ProbeResults({ response }: { response: any }) {
  if (!response) return null;

  return (
    <div className="flex flex-col h-full bg-[#0c0c0e] overflow-hidden">
      <div className="h-14 border-b flex items-center px-4 shrink-0 bg-card">
        <div className="text-sm font-semibold text-foreground tracking-wide">Probe Results</div>
        {response.error && (
          <Badge variant="error" className="ml-4">Error</Badge>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-8 bg-background">
        {response.error ? (
          <div className="text-destructive font-mono text-sm whitespace-pre-wrap">
            {JSON.stringify(response.error, null, 2)}
          </div>
        ) : (
          <>
            {response.timing && response.timing.length > 0 && <TimingResult rounds={response.timing} />}
            {response.partial && <PartialResult round={response.partial} />}
            {response.expect100 && <Expect100Result round={response.expect100} />}
            {response.race && <RaceResultView race={response.race} />}
            {response.cross && <CrossResult rounds={response.cross} />}
            {response.methodprobe && <MethodProbeResult rounds={response.methodprobe} />}
            {response.validationprobe && <ValidationProbeResult rounds={response.validationprobe} />}
            
            {!response.timing && !response.partial && !response.expect100 && !response.race && !response.cross && !response.methodprobe && !response.validationprobe && (
              <div className="text-muted-foreground text-sm font-mono text-center mt-10">
                No probe techniques were executed.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TimingResult({ rounds }: { rounds: any[] }) {
  const durations = rounds.map(r => r.durationMs);
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  
  const firstBody = rounds[0]?.body;
  const varianceDetected = rounds.some(r => r.body !== firstBody);
  
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timing</h3>
      <div className="flex items-center gap-4 text-sm font-mono bg-muted/20 p-3 rounded-md border border-border/50">
        <div>Min: <span className="text-foreground">{min}ms</span></div>
        <div>Max: <span className="text-foreground">{max}ms</span></div>
        <div>Avg: <span className="text-foreground">{avg}ms</span></div>
        {varianceDetected && (
          <div className="text-orange-400 font-sans text-xs bg-orange-400/10 px-2 py-1 rounded ml-auto">
            Variance detected — server returned different responses
          </div>
        )}
      </div>
      
      <div className="border border-border/50 rounded-md overflow-hidden">
        <table className="w-full text-left text-sm font-mono">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <th className="px-3 py-2 border-b w-16 text-muted-foreground">Round</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Duration</th>
              <th className="px-3 py-2 border-b w-20 text-muted-foreground">Status</th>
              <th className="px-3 py-2 border-b text-muted-foreground">Body Preview</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {rounds.map((r, i) => (
              <TimingRow key={i} round={r} index={i} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getStatusVariant(status: number) {
  if (status === 0 || status >= 400) return 'error';
  if (status >= 300 || status < 200) return 'warning';
  return 'success';
}

function TimingRow({ round, index }: { round: any, index: number }) {
  const [expanded, setExpanded] = useState(false);
  const bodyStr = typeof round.body === 'string' ? round.body : JSON.stringify(round.body);
  const bodySnippet = bodyStr ? bodyStr.substring(0, 120) : '';
  const hasMore = bodyStr && bodyStr.length > 120;
  
  return (
    <tr className="hover:bg-muted/10 transition-colors">
      <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
      <td className="px-3 py-2">{round.durationMs}ms</td>
      <td className="px-3 py-2">
        <Badge variant={getStatusVariant(round.status)}>
          {round.status}
        </Badge>
      </td>
      <td className="px-3 py-2">
        {bodyStr ? (
          <div 
            className={`flex gap-2 ${hasMore ? 'cursor-pointer' : ''}`} 
            onClick={() => hasMore && setExpanded(!expanded)}
          >
            <span className="text-muted-foreground whitespace-pre-wrap flex-1 break-all text-[11px] leading-tight">
              {expanded ? bodyStr : bodySnippet + (hasMore && !expanded ? '...' : '')}
            </span>
            {hasMore && (
              <span className="text-muted-foreground shrink-0 mt-0.5">
                {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </span>
            )}
          </div>
        ) : round.error ? (
          <span className="text-destructive text-[11px] font-mono break-all">{round.error}</span>
        ) : (
          <span className="text-muted-foreground/50 text-[11px] italic">Empty body</span>
        )}
      </td>
    </tr>
  );
}

function PartialResult({ round }: { round: any }) {
  const [headersOpen, setHeadersOpen] = useState(false);
  const bodyStr = typeof round.body === 'string' ? round.body : JSON.stringify(round.body);
  
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Partial Read</h3>
      <div className="p-4 border border-border/50 rounded-md space-y-4 bg-muted/5">
        <div className="flex items-center gap-4">
          <Badge variant={getStatusVariant(round.status)}>
            {round.status}
          </Badge>
          <span className="text-sm font-mono">{round.durationMs}ms</span>
        </div>
        
        {round.responseHeaders && Object.keys(round.responseHeaders).length > 0 && (
          <div>
            <div 
              className="flex items-center gap-1 text-xs font-mono text-muted-foreground cursor-pointer hover:text-primary mb-2 w-max"
              onClick={() => setHeadersOpen(!headersOpen)}
            >
              {headersOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Response Headers
            </div>
            {headersOpen && (
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px] font-mono pl-4 bg-muted/20 p-2 rounded">
                {Object.entries(round.responseHeaders).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <div className="text-primary/70">{k}:</div>
                    <div className="text-foreground break-all">{String(v)}</div>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        )}
        
        {round.error && (
          <div>
            <div className="text-xs text-muted-foreground mb-1 font-mono">Error</div>
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded font-mono whitespace-pre-wrap break-all">
              {round.error}
            </div>
          </div>
        )}

        {bodyStr ? (
          <div>
            <div className="text-xs text-muted-foreground mb-1 font-mono">Body (first 512 bytes)</div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-background p-3 rounded border border-border/30 max-h-40 overflow-y-auto">
              {bodyStr}
            </pre>
          </div>
        ) : !round.error && (
          <span className="text-muted-foreground/50 text-[11px] italic">Empty body</span>
        )}
      </div>
    </div>
  );
}

function RaceResultView({ race }: { race: any }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const attempts: any[] = race.attempts || [];

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Race (single-packet attack)</h3>
      <div className="p-4 border border-border/50 rounded-md space-y-4 bg-muted/5">
        <div className="flex items-center gap-4 flex-wrap">
          <Badge variant={race.raceLikely ? 'error' : 'success'}>
            {race.raceLikely ? 'RACE CONDITION LIKELY' : 'No race detected'}
          </Badge>
          <div className="text-sm font-mono">
            {race.successCount} / {attempts.length} succeeded
          </div>
          <div className="text-sm font-mono text-muted-foreground">
            release skew: {race.releaseSkewMs}ms
          </div>
        </div>

        {race.error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded font-mono whitespace-pre-wrap break-all">
            {race.error}
          </div>
        )}

        {race.note && (
          <div className="text-sm text-primary bg-primary/10 border border-primary/20 p-3 rounded font-mono">
            {race.note}
          </div>
        )}

        <div className="border border-border/50 rounded-md overflow-hidden">
          <table className="w-full text-left text-sm font-mono">
            <thead className="bg-muted/30 text-xs">
              <tr>
                <th className="px-3 py-2 border-b w-16 text-muted-foreground">#</th>
                <th className="px-3 py-2 border-b w-24 text-muted-foreground">Status</th>
                <th className="px-3 py-2 border-b w-28 text-muted-foreground">Connect</th>
                <th className="px-3 py-2 border-b w-28 text-muted-foreground">Suffix sent</th>
                <th className="px-3 py-2 border-b text-muted-foreground">Body / Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {attempts.map((a, i) => {
                const bodyStr = typeof a.body === 'string' ? a.body : a.body ? JSON.stringify(a.body) : '';
                const hasMore = bodyStr && bodyStr.length > 100;
                const expanded = expandedIdx === i;
                return (
                  <tr key={i} className="hover:bg-muted/10 transition-colors align-top">
                    <td className="px-3 py-2 text-muted-foreground">{a.index}</td>
                    <td className="px-3 py-2">
                      <Badge variant={getStatusVariant(a.status)}>{a.status || 'err'}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {typeof a.connectMs === 'number' ? `${a.connectMs}ms` : '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {typeof a.suffixSentAt === 'number' ? `+${a.suffixSentAt}ms` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {a.error ? (
                        <span className="text-destructive text-[11px] break-all">{a.error}</span>
                      ) : bodyStr ? (
                        <div 
                          className={`flex gap-2 ${hasMore ? 'cursor-pointer' : ''}`} 
                          onClick={() => hasMore && setExpandedIdx(expanded ? null : i)}
                        >
                          <span className="text-muted-foreground whitespace-pre-wrap flex-1 break-all text-[11px] leading-tight">
                            {expanded ? bodyStr : bodyStr.substring(0, 100) + (hasMore ? '...' : '')}
                          </span>
                          {hasMore && (
                            <span className="text-muted-foreground shrink-0 mt-0.5">
                              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50 text-[11px] italic">Empty body</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MethodProbeResult({ rounds }: { rounds: any[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Method Probe</h3>
      <div className="text-xs text-muted-foreground bg-muted/10 p-2 rounded border border-border/30">
        Non-mutating methods sent with the same auth. None of these register a game action.
      </div>
      <div className="border border-border/50 rounded-md overflow-hidden">
        <table className="w-full text-left text-sm font-mono">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Method</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Duration</th>
              <th className="px-3 py-2 border-b w-20 text-muted-foreground">Status</th>
              <th className="px-3 py-2 border-b w-40 text-muted-foreground">Allow</th>
              <th className="px-3 py-2 border-b text-muted-foreground">Body / Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {rounds.map((r, i) => {
              const bodyStr = typeof r.body === 'string' ? r.body : r.body ? JSON.stringify(r.body) : '';
              return (
                <tr key={i} className="hover:bg-muted/10 transition-colors align-top">
                  <td className="px-3 py-2 font-bold text-primary">{r.httpMethod}</td>
                  <td className="px-3 py-2">{r.durationMs}ms</td>
                  <td className="px-3 py-2">
                    <Badge variant={getStatusVariant(r.status)}>{r.status || 'err'}</Badge>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-green-400 break-all">{r.allowHeader || '—'}</td>
                  <td className="px-3 py-2">
                    {r.error ? (
                      <span className="text-destructive text-[11px] break-all">{r.error}</span>
                    ) : bodyStr ? (
                      <span className="text-muted-foreground whitespace-pre-wrap flex-1 break-all text-[11px] leading-tight">
                        {bodyStr.substring(0, 160)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50 text-[11px] italic">Empty body</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ValidationProbeResult({ rounds }: { rounds: any[] | { error: string } }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!Array.isArray(rounds)) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Validation Probe</h3>
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded font-mono">
          {(rounds as any).error}
        </div>
      </div>
    );
  }

  const committed = rounds.filter(r => r.committed);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Validation Probe</h3>
      {committed.length > 0 && (
        <div className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 p-2 rounded">
          ⚠ {committed.length} patch(es) returned 2xx — these may have registered a real action: {committed.map(r => r.patch).join(', ')}
        </div>
      )}
      <div className="border border-border/50 rounded-md overflow-hidden">
        <table className="w-full text-left text-sm font-mono">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <th className="px-3 py-2 border-b w-32 text-muted-foreground">Patch</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Duration</th>
              <th className="px-3 py-2 border-b w-20 text-muted-foreground">Status</th>
              <th className="px-3 py-2 border-b text-muted-foreground">Body / Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {rounds.map((r, i) => {
              const bodyStr = typeof r.body === 'string' ? r.body : r.body ? JSON.stringify(r.body) : '';
              const hasMore = bodyStr && bodyStr.length > 120;
              const expanded = expandedIdx === i;
              return (
                <tr key={i} className={`hover:bg-muted/10 transition-colors align-top ${r.committed ? 'bg-yellow-400/5' : ''}`}>
                  <td className="px-3 py-2 text-[11px] text-primary break-all">{r.patch}</td>
                  <td className="px-3 py-2">{r.durationMs}ms</td>
                  <td className="px-3 py-2">
                    <Badge variant={getStatusVariant(r.status)}>{r.status || 'err'}</Badge>
                    {r.committed && <span className="ml-1 text-[9px] text-yellow-400">⚠committed</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.error ? (
                      <span className="text-destructive text-[11px] break-all">{r.error}</span>
                    ) : bodyStr ? (
                      <div
                        className={`flex gap-2 ${hasMore ? 'cursor-pointer' : ''}`}
                        onClick={() => hasMore && setExpandedIdx(expanded ? null : i)}
                      >
                        <span className="text-muted-foreground whitespace-pre-wrap flex-1 break-all text-[11px] leading-tight">
                          {expanded ? bodyStr : bodyStr.substring(0, 120) + (hasMore && !expanded ? '...' : '')}
                        </span>
                        {hasMore && (
                          <span className="text-muted-foreground shrink-0 mt-0.5">
                            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/50 text-[11px] italic">Empty body</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CrossResult({ rounds }: { rounds: any[] | { error: string } }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!Array.isArray(rounds)) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cross-Site Probe</h3>
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded font-mono">
          {(rounds as any).error}
        </div>
      </div>
    );
  }

  const siteARows = rounds.filter(r => r.site === 'A');
  const siteBRows = rounds.filter(r => r.site === 'B');
  const aOk = siteARows.filter(r => r.status >= 200 && r.status < 300).length;
  const bOk = siteBRows.filter(r => r.status >= 200 && r.status < 300).length;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cross-Site Probe</h3>
      <div className="flex items-center gap-4 text-xs font-mono bg-muted/20 p-3 rounded-md border border-border/50 flex-wrap">
        <div>Rounds: <span className="text-foreground">{rounds.length}</span></div>
        <div className="text-blue-400">Site A URL (B token+body): <span className="text-foreground">{siteARows.length} rounds, {aOk} ✓</span></div>
        <div className="text-purple-400">Site B URL (A token+body): <span className="text-foreground">{siteBRows.length} rounds, {bOk} ✓</span></div>
      </div>

      <div className="border border-border/50 rounded-md overflow-hidden">
        <table className="w-full text-left text-sm font-mono">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <th className="px-3 py-2 border-b w-16 text-muted-foreground">Round</th>
              <th className="px-3 py-2 border-b w-20 text-muted-foreground">Site</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Duration</th>
              <th className="px-3 py-2 border-b w-20 text-muted-foreground">Status</th>
              <th className="px-3 py-2 border-b text-muted-foreground">Body / Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {rounds.map((r, i) => {
              const bodyStr = typeof r.body === 'string' ? r.body : r.body ? JSON.stringify(r.body) : '';
              const hasMore = bodyStr && bodyStr.length > 120;
              const expanded = expandedIdx === i;
              const siteColor = r.site === 'A' ? 'text-blue-400' : 'text-purple-400';
              return (
                <tr key={i} className="hover:bg-muted/10 transition-colors align-top">
                  <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                  <td className={`px-3 py-2 font-bold ${siteColor}`}>
                    <div>{r.site === 'A' ? 'A→B' : 'B→A'}</div>
                    <div className="text-[9px] font-normal text-muted-foreground normal-case">url:{r.site} auth:{r.authSite}</div>
                  </td>
                  <td className="px-3 py-2">{r.durationMs}ms</td>
                  <td className="px-3 py-2">
                    <Badge variant={getStatusVariant(r.status)}>{r.status || 'err'}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {r.error ? (
                      <span className="text-destructive text-[11px] break-all">{r.error}</span>
                    ) : bodyStr ? (
                      <div
                        className={`flex gap-2 ${hasMore ? 'cursor-pointer' : ''}`}
                        onClick={() => hasMore && setExpandedIdx(expanded ? null : i)}
                      >
                        <span className="text-muted-foreground whitespace-pre-wrap flex-1 break-all text-[11px] leading-tight">
                          {expanded ? bodyStr : bodyStr.substring(0, 120) + (hasMore && !expanded ? '...' : '')}
                        </span>
                        {hasMore && (
                          <span className="text-muted-foreground shrink-0 mt-0.5">
                            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/50 text-[11px] italic">Empty body</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Expect100Result({ round }: { round: any }) {
  const bodyStr = typeof round.body === 'string' ? round.body : JSON.stringify(round.body);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Expect-100</h3>
      <div className="p-4 border border-border/50 rounded-md space-y-4 bg-muted/5">
        <div className="flex items-center gap-4">
          <Badge variant={getStatusVariant(round.status)}>
            {round.status}
          </Badge>
          <span className="text-sm font-mono">{round.durationMs}ms</span>
        </div>
        
        {round.note && (
          <div className="text-sm text-primary bg-primary/10 border border-primary/20 p-3 rounded font-mono">
            {round.note}
          </div>
        )}

        {round.error && (
          <div>
            <div className="text-xs text-muted-foreground mb-1 font-mono">Error</div>
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded font-mono whitespace-pre-wrap break-all">
              {round.error}
            </div>
          </div>
        )}
        
        {bodyStr ? (
          <div>
            <div className="text-xs text-muted-foreground mb-1 font-mono">Body</div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-background p-3 rounded border border-border/30 max-h-40 overflow-y-auto">
              {bodyStr}
            </pre>
          </div>
        ) : !round.error && (
          <span className="text-muted-foreground/50 text-[11px] italic">Empty body</span>
        )}
      </div>
    </div>
  );
}