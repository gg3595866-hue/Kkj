import React, { useState } from 'react';
import { Button, Textarea, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/core';
import { Download } from 'lucide-react';
import { AppRequestState, HeaderRow } from './types';
import { ProxyRequestInputMethod } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

export function ImportFetchDialog({ request, setRequest }: { request: AppRequestState, setRequest: React.Dispatch<React.SetStateAction<AppRequestState>> }) {
  const [open, setOpen] = useState(false);
  const [fetchInput, setFetchInput] = useState('');
  const { toast } = useToast();

  const handleImport = async () => {
    try {
      if (!fetchInput.trim()) return;

      let interceptedUrl: string | undefined;
      let interceptedOptions: any = undefined;

      const mockFetch = (url: string, options: any) => {
        interceptedUrl = url;
        interceptedOptions = options;
        return Promise.resolve(); // mock response
      };

      try {
        const func = new AsyncFunction('fetch', fetchInput);
        await func(mockFetch);
      } catch (e) {
        console.error("Evaluation error, trying fallback regex extraction", e);
        // Fallback for simple cases if AsyncFunction fails
        const urlMatch = fetchInput.match(/fetch\s*\(\s*['"](.*?)['"]/);
        if (urlMatch && urlMatch[1]) interceptedUrl = urlMatch[1];
        
        // Very basic fallback parser for options
        const optionsMatch = fetchInput.match(/fetch\s*\(\s*['"][^'"]*['"]\s*,\s*(\{[\s\S]*\})\s*\)/);
        if (optionsMatch && optionsMatch[1]) {
          try {
            interceptedOptions = new Function('return ' + optionsMatch[1])();
          } catch (e2) {}
        }
      }

      if (!interceptedUrl) {
        toast({ title: "Failed to parse", description: "Could not find a valid fetch URL in the input.", variant: "destructive" });
        return;
      }

      let url = interceptedUrl || request.url;
      let method = 'GET' as ProxyRequestInputMethod;
      let body = '';
      let contentType = request.contentType;
      let headers: HeaderRow[] = [];
      let bearerToken = request.bearerToken;
      let authHeaderName = request.authHeaderName;

      if (interceptedOptions) {
        if (interceptedOptions.method) {
          method = interceptedOptions.method.toUpperCase() as ProxyRequestInputMethod;
        }

        if (interceptedOptions.body) {
          body = typeof interceptedOptions.body === 'string' ? interceptedOptions.body : JSON.stringify(interceptedOptions.body, null, 2);
        }

        if (interceptedOptions.headers) {
          let rawHeaders: Record<string, string> = {};
          if (interceptedOptions.headers instanceof Headers) {
             interceptedOptions.headers.forEach((value: string, key: string) => {
               rawHeaders[key] = value;
             });
          } else if (Array.isArray(interceptedOptions.headers)) {
            interceptedOptions.headers.forEach(([key, value]) => {
              rawHeaders[key] = value;
            });
          } else {
            rawHeaders = interceptedOptions.headers;
          }

          for (const [k, v] of Object.entries(rawHeaders)) {
            const key = k;
            const value = String(v);
            
            const lowerKey = key.toLowerCase();
            if (lowerKey.startsWith('sec-fetch-') || lowerKey.startsWith('sec-ch-ua-')) {
              continue; // Skip browser internals
            }

            if (lowerKey === 'content-type') {
              contentType = value;
              continue; // Handled separately
            }

            // Check for Bearer token
            if (value.startsWith('Bearer ')) {
              authHeaderName = key;
              bearerToken = value.slice(7).trim(); // Remove "Bearer "
              continue; 
            }

            headers.push({ id: crypto.randomUUID(), key, value });
          }
        }
      }

      setRequest({
        url,
        method,
        body,
        contentType,
        headers,
        bearerToken,
        authHeaderName
      });

      setOpen(false);
      setFetchInput('');
      toast({ title: "Fetch imported successfully" });

    } catch (err) {
      console.error(err);
      toast({ title: "Error importing fetch", description: "An unexpected error occurred while parsing.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="shrink-0 px-3 flex items-center gap-2" title="Import fetch()">
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Import fetch()</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import fetch()</DialogTitle>
        </DialogHeader>
        <div className="py-4 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Paste a browser DevTools <code>fetch()</code> call below to populate the request builder.</p>
          <Textarea 
            className="font-mono text-xs min-h-[250px]" 
            placeholder={`fetch("https://api.example.com/data", {\n  "headers": {\n    "Authorization": "Bearer token..."\n  },\n  "method": "POST"\n});`}
            value={fetchInput}
            onChange={e => setFetchInput(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={!fetchInput.trim()}>Import</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
