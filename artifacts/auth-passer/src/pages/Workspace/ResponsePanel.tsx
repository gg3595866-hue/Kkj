import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent, Badge, Input, Button } from '@/components/ui/core';

export function ResponsePanel({ response }: { response: any }) {
  const [iframeInput, setIframeInput] = useState('');
  const [iframeSrc, setIframeSrc] = useState('');

  let formattedBody = response?.body;
  if (formattedBody && typeof formattedBody === 'string') {
    try {
      formattedBody = JSON.stringify(JSON.parse(formattedBody), null, 2);
    } catch (e) {
      // not json, leave as is
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
          {response && !response.error && (
            <div className="flex items-center gap-3 text-sm">
              <Badge variant={response.status < 400 ? 'success' : 'error'}>
                {response.status} {response.statusText}
              </Badge>
              <span className="text-muted-foreground font-mono text-xs bg-muted/30 px-2 py-0.5 rounded border border-border/50">{response.durationMs}ms</span>
            </div>
          )}
        </div>

        <TabsContent value="response" className="flex-1 overflow-hidden m-0 data-[state=active]:flex flex-col bg-background">
          {response ? (
            response.error ? (
              <div className="p-4 text-destructive font-mono text-sm overflow-auto h-full whitespace-pre-wrap">
                {JSON.stringify(response.error, null, 2)}
              </div>
            ) : (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="p-4 border-b shrink-0 max-h-[30%] overflow-auto bg-[#0a0a0c]">
                  <h3 className="text-[10px] font-semibold text-muted-foreground mb-3 uppercase tracking-widest">Response Headers</h3>
                  <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs font-mono">
                    {Object.entries(response.headers || {}).map(([k, v]) => (
                      <React.Fragment key={k}>
                        <div className="text-primary/80">{k}:</div>
                        <div className="text-foreground break-all">{String(v)}</div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4 bg-background">
                  <pre className="font-mono text-[13px] leading-relaxed text-foreground whitespace-pre-wrap">
                    {formattedBody}
                  </pre>
                </div>
              </div>
            )
          ) : (
             <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm font-mono bg-background">
               Awaiting request...
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
