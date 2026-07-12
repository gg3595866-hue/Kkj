import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowRightCircle, Search } from 'lucide-react';
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

  const results: ScanResultEntry[] = response.results || [];
  const withData = results.filter(r => r.hasData);
  const withoutData = results.filter(r => !r.hasData);

  const buildUrl = (path: string) => {
    const base = (baseUrl || '').replace(/\/$/, '');
    const qs = queryParams ? `?${queryParams}` : '';
    return `${base}/${path}${qs}`;
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden text-sm border-l border-border">
      <div className="p-4 border-b bg-card shrink-0 flex items-center justify-between">
        <h2 className="font-mono font-bold text-primary flex items-center gap-2">
          <Search className="w-4 h-4" /> Scan Results
        </h2>
        <div className="text-xs text-muted-foreground">
          {withData.length} responded · {withoutData.length} empty/blocked
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {results.length === 0 && (
          <div className="text-muted-foreground text-xs">No results.</div>
        )}

        {withData.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Responded with data</h3>
            {withData.map((r, i) => (
              <ScanRow key={i} result={r} url={buildUrl(r.path)} onRouteThrough={onRouteThrough} />
            ))}
          </div>
        )}

        {withoutData.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">No useful data</h3>
            {withoutData.map((r, i) => (
              <ScanRow key={i} result={r} url={buildUrl(r.path)} onRouteThrough={onRouteThrough} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
