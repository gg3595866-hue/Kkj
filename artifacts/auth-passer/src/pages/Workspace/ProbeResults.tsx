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
            {response.replay && <ReplayResult rounds={response.replay} />}
            {response.methodprobe && <MethodProbeResult rounds={response.methodprobe} />}
            {response.validationprobe && <ValidationProbeResult rounds={response.validationprobe} />}
            {response.idprobe && <IdentityProbeResult result={response.idprobe} />}
            {response.surrogateprobe && <SurrogateProbeResult result={response.surrogateprobe} />}
            {response.jwtprobe && <JwtTamperProbeResult result={response.jwtprobe} />}
            
            {!response.timing && !response.partial && !response.expect100 && !response.race && !response.cross && !response.methodprobe && !response.validationprobe && !response.replay && !response.idprobe && !response.surrogateprobe && !response.jwtprobe && (
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

function ReplayResult({ rounds }: { rounds: any[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const commit = rounds[0];
  const replays = rounds.slice(1);
  const allReplaysRejected = replays.length > 0 && replays.every(r => r.status >= 400 || r.status === 0);
  const anyReplayCommitted = replays.some(r => r.safeReplay === false && r.status >= 200 && r.status < 300);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Replay Probe</h3>

      {allReplaysRejected && (
        <div className="text-xs text-green-400 bg-green-400/10 border border-green-400/30 p-2 rounded">
          ✓ Server rejected all replays — replaying a committed AN is safe (no double-commit)
        </div>
      )}
      {anyReplayCommitted && (
        <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/30 p-2 rounded">
          ⚠ One or more replays returned 2xx — server may be idempotent or committed a second action
        </div>
      )}

      <div className="text-xs text-muted-foreground bg-muted/10 p-2 rounded border border-border/30">
        Round 1 body often contains a pre-determined game board in the <span className="text-primary font-mono">RS</span> field — check it for all future row outcomes before playing them.
      </div>

      <div className="border border-border/50 rounded-md overflow-hidden">
        <table className="w-full text-left text-sm font-mono">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <th className="px-3 py-2 border-b w-16 text-muted-foreground">Round</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Type</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Duration</th>
              <th className="px-3 py-2 border-b w-20 text-muted-foreground">Status</th>
              <th className="px-3 py-2 border-b text-muted-foreground">Body</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {rounds.map((r, i) => {
              const bodyStr = typeof r.body === 'string' ? r.body : r.body ? JSON.stringify(r.body) : '';
              const hasMore = bodyStr && bodyStr.length > 120;
              const expanded = expandedIdx === i;
              return (
                <tr key={i} className={`hover:bg-muted/10 transition-colors align-top ${r.isCommit ? 'bg-yellow-400/5' : r.safeReplay ? 'bg-green-400/5' : ''}`}>
                  <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2">
                    {r.isCommit
                      ? <span className="text-yellow-400 text-[11px] font-bold">COMMIT</span>
                      : r.safeReplay
                      ? <span className="text-green-400 text-[11px] font-bold">SAFE REPLAY</span>
                      : <span className="text-red-400 text-[11px] font-bold">⚠ RE-COMMITTED</span>
                    }
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

function JwtTamperProbeResult({ result }: { result: any }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (result.error) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">JWT Tamper Probe</h3>
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded font-mono">{result.error}</div>
      </div>
    );
  }

  const isCritical = result.verdict === "signature_not_verified";

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">JWT Tamper Probe</h3>

      {/* Verdict banner */}
      <div className={`text-xs p-3 rounded border font-mono leading-relaxed ${isCritical ? 'text-red-400 bg-red-400/10 border-red-400/30' : 'text-green-400 bg-green-400/10 border-green-400/30'}`}>
        {result.verdictDetail}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs font-mono bg-muted/10 p-3 rounded border border-border/30">
        <span className="text-muted-foreground">Original sub</span>
        <span>{result.origSub}</span>
        <span className="text-muted-foreground">Fake sub used</span>
        <span className="text-primary">{result.fakeSub}</span>
        <span className="text-muted-foreground">Fake user ID</span>
        <span className="text-primary">{result.fakeUserId}</span>
        <span className="text-muted-foreground">Body field patched</span>
        <span>{result.uiField} → {result.fakeUserId}</span>
      </div>

      {/* Results table */}
      <div className="border border-border/50 rounded-md overflow-hidden">
        <table className="w-full text-left text-sm font-mono">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <th className="px-3 py-2 border-b text-muted-foreground">Variant</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Duration</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Status</th>
              <th className="px-3 py-2 border-b text-muted-foreground">Body / Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {(result.results ?? []).map((r: any, i: number) => {
              const bodyStr = typeof r.body === 'string' ? r.body : r.body ? JSON.stringify(r.body) : '';
              const hasMore = bodyStr && bodyStr.length > 120;
              const expanded = expandedIdx === i;
              return (
                <tr key={i} className={`hover:bg-muted/10 transition-colors align-top ${r.committed ? 'bg-red-400/10' : ''}`}>
                  <td className="px-3 py-2">
                    <div className={`font-semibold text-xs ${r.committed ? 'text-red-400' : 'text-foreground'}`}>{r.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{r.desc}</div>
                    {r.committed && <div className="text-[10px] text-red-400 mt-0.5">🚨 ACCEPTED — signature NOT verified</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.durationMs}ms</td>
                  <td className="px-3 py-2">
                    <Badge variant={getStatusVariant(r.status)}>{r.status || 'err'}</Badge>
                    {r.committed
                      ? <div className="text-[9px] text-red-400 mt-0.5">⚠ accepted</div>
                      : <div className="text-[9px] text-green-400 mt-0.5">rejected</div>
                    }
                  </td>
                  <td className="px-3 py-2">
                    {r.error ? (
                      <span className="text-destructive text-[11px] break-all">{r.error}</span>
                    ) : bodyStr ? (
                      <div className={`flex gap-2 ${hasMore ? 'cursor-pointer' : ''}`}
                        onClick={() => hasMore && setExpandedIdx(expanded ? null : i)}>
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

function SurrogateProbeResult({ result }: { result: any }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const verdictConfig: Record<string, { label: string; className: string }> = {
    safe_surrogate_channel: {
      label: '✓ SAFE PROBING CHANNEL CONFIRMED — Server uses UI field (not JWT) as game-state key. ' +
             'Your real account is untouched. Any request with a fake/nonexistent UI will return 422 safely.',
      className: 'text-green-400 bg-green-400/10 border-green-400/30',
    },
    safe_rejected: {
      label: '✓ All surrogate requests rejected safely. Real account untouched.',
      className: 'text-green-400 bg-green-400/10 border-green-400/30',
    },
    surrogate_committed: {
      label: '⚠ A surrogate request got 2xx — if you used a real account ID, an action may have committed on that account. ' +
             'This confirms the JWT is NOT the write key — only the UI body field determines whose state changes.',
      className: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
    },
    unknown: {
      label: '△ Mixed or unexpected results — review per-request statuses below.',
      className: 'text-muted-foreground bg-muted/10 border-border/30',
    },
  };

  const vc = verdictConfig[result.verdict] ?? verdictConfig.unknown;

  const controlRow = (result.results ?? []).find((r: any) => r.kind === 'control');
  const surrogateRows = (result.results ?? []).filter((r: any) => r.kind === 'surrogate');

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Surrogate Identity Probe</h3>

      <div className={`text-xs p-3 rounded border font-mono leading-relaxed ${vc.className}`}>
        {vc.label}
      </div>

      {/* JWT + field summary */}
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs font-mono bg-muted/10 p-3 rounded border border-border/30">
        <span className="text-muted-foreground">JWT sub</span>
        <span>{result.jwtSub ?? <span className="italic text-muted-foreground/60">not found</span>}</span>

        <span className="text-muted-foreground">JWT user ID</span>
        <span className={result.jwtUserId != null ? 'text-primary' : 'text-muted-foreground/60 italic'}>
          {result.jwtUserId ?? 'could not parse'}
          {result.jwtExpired && <span className="ml-2 text-red-400 text-[10px]">⚠ JWT expired</span>}
        </span>

        <span className="text-muted-foreground">Lookup field</span>
        <span className="font-bold">{result.uiField}</span>

        <span className="text-muted-foreground">Real {result.uiField}</span>
        <span>{result.realUiValue ?? <span className="italic text-muted-foreground/60">not found in body</span>}</span>

        <span className="text-muted-foreground">Surrogate IDs</span>
        <span className="text-primary">{(result.surrogateUiValues ?? []).join(', ')}</span>
      </div>

      {/* Control row */}
      {controlRow && (
        <div className="border border-border/50 rounded-md p-3 space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Control (real {result.uiField})</div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <Badge variant={getStatusVariant(controlRow.status)}>{controlRow.status || 'err'}</Badge>
            <span>{controlRow.durationMs}ms</span>
            {controlRow.committed && <span className="text-yellow-400 text-[10px]">⚠ action committed on real account</span>}
          </div>
          {controlRow.body && (
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-background p-2 rounded border border-border/30 max-h-24 overflow-y-auto mt-1">
              {controlRow.body}
            </pre>
          )}
        </div>
      )}

      {/* Surrogate table */}
      <div className="border border-border/50 rounded-md overflow-hidden">
        <table className="w-full text-left text-sm font-mono">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <th className="px-3 py-2 border-b text-muted-foreground">Surrogate {result.uiField}</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Duration</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Status</th>
              <th className="px-3 py-2 border-b text-muted-foreground">Body / Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {surrogateRows.map((r: any, i: number) => {
              const bodyStr = typeof r.body === 'string' ? r.body : r.body ? JSON.stringify(r.body) : '';
              const hasMore = bodyStr && bodyStr.length > 120;
              const expanded = expandedIdx === i;
              return (
                <tr key={i} className={`hover:bg-muted/10 transition-colors align-top ${r.committed ? 'bg-yellow-400/5' : 'bg-green-400/5'}`}>
                  <td className="px-3 py-2">
                    <div className="text-[10px] text-muted-foreground mb-0.5">round {r.round}</div>
                    <div className="text-primary font-bold">{r.surrogateUiValue}</div>
                    {r.jwtTampered && r.fakeSub && (
                      <div className="text-[10px] text-yellow-400 mt-0.5">JWT sub → {r.fakeSub}</div>
                    )}
                    {!r.jwtTampered && (
                      <div className="text-[10px] text-red-400 mt-0.5">⚠ JWT not tampered</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.durationMs}ms</td>
                  <td className="px-3 py-2">
                    <Badge variant={getStatusVariant(r.status)}>{r.status || 'err'}</Badge>
                    {r.committed
                      ? <div className="text-[9px] text-yellow-400 mt-0.5">⚠ committed</div>
                      : <div className="text-[9px] text-green-400 mt-0.5">safe</div>
                    }
                  </td>
                  <td className="px-3 py-2">
                    {r.error ? (
                      <span className="text-destructive text-[11px] break-all">{r.error}</span>
                    ) : bodyStr ? (
                      <div className={`flex gap-2 ${hasMore ? 'cursor-pointer' : ''}`}
                        onClick={() => hasMore && setExpandedIdx(expanded ? null : i)}>
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

      {/* Note row */}
      {surrogateRows[0]?.note && (
        <div className="text-xs font-mono text-muted-foreground bg-muted/10 p-2 rounded border border-border/30">
          {surrogateRows[0].note}
        </div>
      )}
    </div>
  );
}

function IdentityProbeResult({ result }: { result: any }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const verdictConfig = {
    jwt_bound: {
      label: '✓ JWT↔Body binding enforced — mismatched UI requests are SAFE to use as probes',
      className: 'text-green-400 bg-green-400/10 border-green-400/30',
    },
    ui_independent: {
      label: '⚠ Server accepted a mismatched UI — body UI field may be independent of JWT. Probing this way is NOT safe.',
      className: 'text-red-400 bg-red-400/10 border-red-400/30',
    },
    partial: {
      label: '△ Mixed results — some mismatches accepted, some rejected. Further investigation needed.',
      className: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
    },
  };

  const vc = verdictConfig[result.verdict as keyof typeof verdictConfig] ?? {
    label: result.verdict,
    className: 'text-muted-foreground bg-muted/10 border-border/30',
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Identity Mismatch Probe</h3>

      {/* Verdict banner */}
      <div className={`text-xs p-3 rounded border font-mono ${vc.className}`}>
        {vc.label}
      </div>

      {/* JWT + body field summary */}
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs font-mono bg-muted/10 p-3 rounded border border-border/30">
        <span className="text-muted-foreground">JWT sub</span>
        <span className="text-foreground">{result.jwtSub ?? <span className="italic text-muted-foreground/60">not found</span>}</span>

        <span className="text-muted-foreground">JWT user ID</span>
        <span className={result.jwtUserId != null ? 'text-primary' : 'text-muted-foreground/60 italic'}>
          {result.jwtUserId ?? 'could not parse'}
          {result.jwtExpired && <span className="ml-2 text-red-400 text-[10px]">⚠ JWT expired</span>}
        </span>

        <span className="text-muted-foreground">Body field</span>
        <span className="text-foreground font-bold">{result.bodyField}</span>

        <span className="text-muted-foreground">Body {result.bodyField}</span>
        <span className={result.bodyUserId != null ? 'text-foreground' : 'text-muted-foreground/60 italic'}>
          {result.bodyUserId ?? 'not found'}
        </span>

        <span className="text-muted-foreground">JWT ↔ body match</span>
        <span className={result.jwtBodyMatch ? 'text-green-400' : 'text-red-400'}>
          {result.jwtBodyMatch ? '✓ match (expected)' : '✗ mismatch (JWT may be wrong)'}
        </span>
      </div>

      {/* Probe table */}
      <div className="border border-border/50 rounded-md overflow-hidden">
        <table className="w-full text-left text-sm font-mono">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <th className="px-3 py-2 border-b w-32 text-muted-foreground">Sent {result.bodyField}</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Duration</th>
              <th className="px-3 py-2 border-b w-24 text-muted-foreground">Status</th>
              <th className="px-3 py-2 border-b text-muted-foreground">Body / Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {(result.probes ?? []).map((p: any, i: number) => {
              const bodyStr = typeof p.body === 'string' ? p.body : p.body ? JSON.stringify(p.body) : '';
              const hasMore = bodyStr && bodyStr.length > 120;
              const expanded = expandedIdx === i;
              return (
                <tr key={i} className={`hover:bg-muted/10 transition-colors align-top ${p.committed ? 'bg-red-400/5' : 'bg-green-400/5'}`}>
                  <td className="px-3 py-2">
                    <div className="text-[10px] text-muted-foreground mb-0.5">{p.label}</div>
                    <div className="text-primary font-bold break-all">{String(p.sentValue)}</div>
                  </td>
                  <td className="px-3 py-2">{p.durationMs}ms</td>
                  <td className="px-3 py-2">
                    <Badge variant={getStatusVariant(p.status)}>{p.status || 'err'}</Badge>
                    {p.committed && <div className="text-[9px] text-red-400 mt-0.5">⚠ committed</div>}
                    {!p.committed && p.status > 0 && <div className="text-[9px] text-green-400 mt-0.5">safe</div>}
                  </td>
                  <td className="px-3 py-2">
                    {p.error ? (
                      <span className="text-destructive text-[11px] break-all">{p.error}</span>
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