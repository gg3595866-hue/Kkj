import React, { useState } from 'react';
import { AppRequestState, HeaderRow } from './types';
import { Button, Input, Textarea, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/core';
import { ProxyRequestInputMethod, useSendProxyRequest, useCreateSavedRequest, getListSavedRequestsQueryKey, getListRequestHistoryQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash, Play, Save } from 'lucide-react';
import { cn } from '@/lib/utils';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export function RequestBuilder({ request, setRequest, setResponse }: { request: AppRequestState, setRequest: React.Dispatch<React.SetStateAction<AppRequestState>>, setResponse: (res: any) => void }) {
  const queryClient = useQueryClient();
  const [saveName, setSaveName] = useState('');
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  
  const createSaved = useCreateSavedRequest();
  const sendProxy = useSendProxyRequest();

  const handleSend = () => {
    const headersRecord: Record<string, string> = {};
    request.headers.forEach(h => {
      if (h.key.trim()) headersRecord[h.key.trim()] = h.value;
    });

    sendProxy.mutate({
      data: {
        url: request.url,
        method: request.method,
        headers: Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
        bearerToken: request.bearerToken || undefined,
        body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? request.body : undefined,
        contentType: request.contentType || undefined
      }
    }, {
      onSuccess: (res) => {
        setResponse(res);
        queryClient.invalidateQueries({ queryKey: getListRequestHistoryQueryKey({ limit: 50 }) });
      },
      onError: (err) => {
        setResponse({ error: err });
      }
    });
  };

  const handleSave = () => {
    if (!saveName.trim()) return;
    const headersRecord: Record<string, string> = {};
    request.headers.forEach(h => {
      if (h.key.trim()) headersRecord[h.key.trim()] = h.value;
    });
    
    createSaved.mutate({
      data: {
        name: saveName,
        url: request.url,
        method: request.method,
        headers: Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
        bearerToken: request.bearerToken || undefined,
        body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? request.body : undefined,
        contentType: request.contentType || undefined
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedRequestsQueryKey() });
        setIsSaveOpen(false);
        setSaveName('');
      }
    });
  };

  const addHeader = () => {
    setRequest(prev => ({ ...prev, headers: [...prev.headers, { id: crypto.randomUUID(), key: '', value: '' }] }));
  };

  const removeHeader = (id: string) => {
    setRequest(prev => ({ ...prev, headers: prev.headers.filter(h => h.id !== id) }));
  };

  const updateHeader = (id: string, field: 'key' | 'value', val: string) => {
    setRequest(prev => ({
      ...prev,
      headers: prev.headers.map(h => h.id === id ? { ...h, [field]: val } : h)
    }));
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden border-r">
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
            onKeyDown={e => e.key === 'Enter' && handleSend()}
          />
          <Button onClick={handleSend} disabled={sendProxy.isPending} className="shrink-0 w-20">
            {sendProxy.isPending ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <><Play className="w-4 h-4 mr-1" /> Send</>}
          </Button>
          
          <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="shrink-0 px-3">
                <Save className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save Request</DialogTitle>
              </DialogHeader>
              <div className="py-4">
                <label className="text-sm font-medium mb-1 block">Request Name</label>
                <Input 
                  placeholder="e.g. Fetch User Profile" 
                  value={saveName} 
                  onChange={e => setSaveName(e.target.value)} 
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setIsSaveOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={createSaved.isPending || !saveName.trim()}>Save</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Authentication</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono bg-muted px-2 py-1 rounded border shrink-0 text-muted-foreground">Bearer</span>
            <Input 
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={request.bearerToken}
              onChange={e => setRequest({...request, bearerToken: e.target.value})}
            />
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Headers</h3>
            <Button variant="ghost" size="sm" onClick={addHeader} className="h-6 text-xs text-primary">
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </div>
          <div className="space-y-2">
            {request.headers.map((h) => (
              <div key={h.id} className="flex items-center gap-2">
                <Input 
                  placeholder="Header-Name" 
                  value={h.key} 
                  onChange={e => updateHeader(h.id, 'key', e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Input 
                  placeholder="Value" 
                  value={h.value} 
                  onChange={e => updateHeader(h.id, 'value', e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeHeader(h.id)}>
                  <Trash className="w-4 h-4" />
                </Button>
              </div>
            ))}
            {request.headers.length === 0 && (
              <div className="text-xs text-muted-foreground font-mono text-center py-2 border rounded border-dashed border-border/50">
                No custom headers
              </div>
            )}
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
