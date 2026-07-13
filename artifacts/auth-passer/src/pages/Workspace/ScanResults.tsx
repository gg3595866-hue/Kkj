import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowRightCircle, Search, GitCompare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/core';

interface ScanResultEntry {
  path: string;
  method: string;
  status: number;
  statusText?: string;
  durationMs: number;
  hasData: boolean;
  body?: string | null;
  error?: string | null;
}

interface DualScanResultEntry {
  path: string;
  isDual: true;
  hasData: boolean;
  statusMismatch: boolean;
  hasDataMismatch: boolean;
  client: ScanResultEntry;
  backend: ScanResultEntry;
}

type AnyEntry = ScanResultEntry | DualScanResultEntry;

function isDual(entry: AnyEntry): entry is DualScanResultEntry {
  return (entry as any).isDual === true;
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

export function ScanResults({ response, baseUrl, queryParams, onRouteThrough }: {
  response: any;
  baseUrl?: string;
  queryParams?: string;
  onRouteThrough: (url: string) => void;
}) {
  if (response.error) {
    return (
      <div className="p-4 bg-background h-full text-red-500 font-mono text-sm overflow-auto">
        Error: {JSON.stringify(response.error, null, 2)}
      </div>
    );
  }

  const results: AnyEntry[] = response.results || [];
  const backendUrl: string | undefined = response.backendUrl;
  const dualMode = results.some(r => isDual(r));

  const withData = results.filter(r => r.hasData);
  const withoutData = results.filter(r => !r.hasData);

  // Dual mode extra stats
  const statusMismatches = dualMode ? results.filter(r => isDual(r) && r.statusMismatch) : [];
  const dataMismatches = dualMode ? results.filter(r => isDual(r) && r.hasDataMismatch) : [];

  const buildUrl = (path: string, base?: string) => {
    const b = (base || baseUrl || '').replace(/\/$/, '');
    const qs = queryParams ? `?${queryParams}` : '';
    return `${b}/${path}${qs}`;
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden text-sm border-l border-border">
      <div className="p-4 border-b bg-card shrink-0 flex items-center justify-between gap-4">
        <h2 className="font-mono font-bold text-primary flex items-center gap-2">
          {dualMode ? <GitCompare className="w-4 h-4" /> : <Search className="w-4 h-4" />}
          {dualMode ? 'Dual-Target Scan Results' : 'Scan Results'}
        </h2>
        <div className="text-xs text-muted-foreground text-right">
          {withData.length} responded · {withoutData.length} empty/blocked
          {dualMode && statusMismatches.length > 0 && (
            <span className="ml-2 text-yellow-400 font-bold">· {statusMismatches.length} status mismatch{statusMismatches.length > 1 ? 'es' : ''}</span>
          )}
        </div>
      </div>

      {/* Dual mode URL legend */}
      {dualMode && (
        <div className="px-4 py-2 border-b bg-muted/10 flex gap-6 text-[11px] font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
            <span className="text-muted-foreground">Client API:</span>
            <span className="text-foreground truncate max-w-[200px]" title={baseUrl}>{baseUrl}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
            <span className="text-muted-foreground">Backend:</span>
            <span className="text-foreground truncate max-w-[200px]" title={backendUrl}>{backendUrl}</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {results.length === 0 && (
          <div className="text-muted-foreground text-xs">No results.</div>
        )}

        {/* Dual mode: mismatches first */}
        {dualMode && statusMismatches.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>⚡</span> Status Mismatches — middleware may be interfering
            </h3>
            {statusMismatches.map((r, i) => (
              <DualScanRow key={i} result={r as DualScanResultEntry} buildUrl={buildUrl} onRouteThrough={onRouteThrough} />
            ))}
          </div>
        )}

        {withData.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Responded with data</h3>
            {withData
              .filter(r => !isDual(r) || !r.statusMismatch)
              .map((r, i) =>
                isDual(r) ? (
                  <DualScanRow key={i} result={r} buildUrl={buildUrl} onRouteThrough={onRouteThrough} />
                ) : (
                  <ScanRow key={i} result={r} url={buildUrl(r.path)} onRouteThrough={onRouteThrough} />
                )
              )}
          </div>
        )}

        {withoutData.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">No useful data</h3>
            {withoutData
              .filter(r => !isDual(r) || !r.statusMismatch)
              .map((r, i) =>
                isDual(r) ? (
                  <DualScanRow key={i} result={r} buildUrl={buildUrl} onRouteThrough={onRouteThrough} />
                ) : (
                  <ScanRow key={i} result={r} url={buildUrl(r.path)} onRouteThrough={onRouteThrough} />
                )
              )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Single-target row ────────────────────────────────────────────────────────

function ScanRow({ result, url, onRouteThrough }: { result: ScanResultEntry; url: string; onRouteThrough: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const hasDetails = !!(result.error || result.body);

  return (
    <div className={cn(
      "border rounded-md overflow-hidden font-mono text-xs",
      result.hasData ? "border-primary/40 bg-primary/5" : "border-border/50 bg-muted/5"
    )}>
      <div className="w-full px-3 py-2 bg-muted/20 flex flex-wrap gap-2 sm:gap-4 items-center justify-between">
        <button
          onClick={() => hasDetails && setOpen(!open)}
          disabled={!hasDetails}
          className={cn(
            "flex items-center gap-2 min-w-0 text-left flex-1",
            hasDetails ? "hover:text-primary cursor-pointer" : "cursor-default"
          )}
        >
          {hasDetails ? (
            open ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
          ) : (
            <span className="w-3 h-3 shrink-0" />
          )}
          <span className="font-bold break-all">/{result.path}</span>
          <span className="text-muted-foreground">{result.method}</span>
        </button>
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap shrink-0">
          <span className="text-muted-foreground">{result.durationMs}ms</span>
          <StatusBadge status={result.status} statusText={result.statusText} />
          <Button
            size="sm"
            variant={result.hasData ? "default" : "outline"}
            className="h-6 px-2 text-[10px]"
            onClick={() => onRouteThrough(url)}
            title="Load this endpoint into the Builder to route requests through it"
          >
            <ArrowRightCircle className="w-3 h-3 mr-1" /> Route here
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border/50 divide-y divide-border/50">
          {result.error && (
            <div className="px-3 py-2 text-red-500 break-all">
              {result.error}
            </div>
          )}
          {result.body && (
            <div className="px-3 py-2">
              <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">Body (first 2000 chars)</div>
              <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                {result.body.slice(0, 2000)}
                {result.body.length > 2000 && <span className="text-muted-foreground">...</span>}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Dual-target row ──────────────────────────────────────────────────────────

function DualScanRow({ result, buildUrl, onRouteThrough }: {
  result: DualScanResultEntry;
  buildUrl: (path: string, base?: string) => string;
  onRouteThrough: (url: string) => void;
}) {
  const [openClient, setOpenClient] = useState(false);
  const [openBackend, setOpenBackend] = useState(false);

  const isMismatch = result.statusMismatch || result.hasDataMismatch;

  return (
    <div className={cn(
      "border rounded-md overflow-hidden font-mono text-xs",
      isMismatch
        ? "border-yellow-400/50 bg-yellow-400/5"
        : result.hasData
        ? "border-primary/30 bg-primary/5"
        : "border-border/50 bg-muted/5"
    )}>
      {/* Header */}
      <div className="px-3 py-2 bg-muted/20 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 font-bold">
          {isMismatch && <span className="text-yellow-400 text-[10px]">⚡ MISMATCH</span>}
          <span className="break-all">/{result.path}</span>
        </div>
        <div className="flex gap-2 text-[10px]">
          {result.statusMismatch && (
            <span className="text-yellow-400">status differs</span>
          )}
          {result.hasDataMismatch && (
            <span className="text-orange-400">data differs</span>
          )}
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-2 divide-x divide-border/50">
        {/* Client column */}
        <div className="flex flex-col">
          <div className="px-3 py-1.5 flex items-center gap-2 bg-blue-500/5 border-b border-border/30">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
            <span className="text-[10px] text-blue-400 font-semibold uppercase tracking-wider">Client API</span>
            <span className="text-muted-foreground text-[10px]">{result.client.method}</span>
            <span className="ml-auto text-muted-foreground text-[10px]">{result.client.durationMs}ms</span>
            <StatusBadge status={result.client.status} statusText={result.client.statusText} />
            <Button size="sm" variant="outline" className="h-5 px-1.5 text-[9px] ml-1"
              onClick={() => onRouteThrough(buildUrl(result.path))}
              title="Route through this client endpoint">
              <ArrowRightCircle className="w-2.5 h-2.5" />
            </Button>
          </div>
          <button
            onClick={() => (result.client.body || result.client.error) && setOpenClient(v => !v)}
            disabled={!result.client.body && !result.client.error}
            className="px-3 py-2 text-left hover:bg-muted/10 transition-colors min-h-[40px] flex items-start gap-1"
          >
            {(result.client.body || result.client.error) && (
              openClient ? <ChevronDown className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
            )}
            <span className={cn("text-[10px] break-all leading-relaxed", result.client.hasData ? "text-foreground" : "text-muted-foreground/60 italic")}>
              {result.client.error
                ? <span className="text-red-400">{result.client.error}</span>
                : result.client.body
                ? (result.client.body.slice(0, 120) + (result.client.body.length > 120 ? '…' : ''))
                : 'No body'}
            </span>
          </button>
          {openClient && result.client.body && (
            <div className="border-t border-border/30 px-3 py-2">
              <pre className="whitespace-pre-wrap break-all text-[10px] leading-relaxed text-foreground">
                {result.client.body.slice(0, 2000)}
                {result.client.body.length > 2000 && <span className="text-muted-foreground">...</span>}
              </pre>
            </div>
          )}
        </div>

        {/* Backend column */}
        <div className="flex flex-col">
          <div className="px-3 py-1.5 flex items-center gap-2 bg-orange-500/5 border-b border-border/30">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
            <span className="text-[10px] text-orange-400 font-semibold uppercase tracking-wider">Backend</span>
            <span className="text-muted-foreground text-[10px]">{result.backend.method}</span>
            <span className="ml-auto text-muted-foreground text-[10px]">{result.backend.durationMs}ms</span>
            <StatusBadge status={result.backend.status} statusText={result.backend.statusText} />
            <Button size="sm" variant="outline" className="h-5 px-1.5 text-[9px] ml-1"
              onClick={() => onRouteThrough(buildUrl(result.path, (result as any).__backendBase))}
              title="Route through this backend endpoint">
              <ArrowRightCircle className="w-2.5 h-2.5" />
            </Button>
          </div>
          <button
            onClick={() => (result.backend.body || result.backend.error) && setOpenBackend(v => !v)}
            disabled={!result.backend.body && !result.backend.error}
            className="px-3 py-2 text-left hover:bg-muted/10 transition-colors min-h-[40px] flex items-start gap-1"
          >
            {(result.backend.body || result.backend.error) && (
              openBackend ? <ChevronDown className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
            )}
            <span className={cn("text-[10px] break-all leading-relaxed", result.backend.hasData ? "text-foreground" : "text-muted-foreground/60 italic")}>
              {result.backend.error
                ? <span className="text-red-400">{result.backend.error}</span>
                : result.backend.body
                ? (result.backend.body.slice(0, 120) + (result.backend.body.length > 120 ? '…' : ''))
                : 'No body'}
            </span>
          </button>
          {openBackend && result.backend.body && (
            <div className="border-t border-border/30 px-3 py-2">
              <pre className="whitespace-pre-wrap break-all text-[10px] leading-relaxed text-foreground">
                {result.backend.body.slice(0, 2000)}
                {result.backend.body.length > 2000 && <span className="text-muted-foreground">...</span>}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
