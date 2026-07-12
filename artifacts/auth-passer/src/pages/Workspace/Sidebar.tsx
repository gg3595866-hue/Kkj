import React from 'react';
import { useListSavedRequests, useListRequestHistory, useDeleteSavedRequest, useClearRequestHistory, getListSavedRequestsQueryKey, getListRequestHistoryQueryKey } from '@workspace/api-client-react';
import { AppRequestState } from './types';
import { Button, Badge } from '@/components/ui/core';
import { Trash2, History, Bookmark, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

export function Sidebar({ request, setRequest }: { request: AppRequestState, setRequest: React.Dispatch<React.SetStateAction<AppRequestState>> }) {
  const queryClient = useQueryClient();
  const { data: savedRequests, isLoading: isLoadingSaved } = useListSavedRequests({ query: { queryKey: getListSavedRequestsQueryKey() } });
  const { data: historyEntries, isLoading: isLoadingHistory } = useListRequestHistory({ limit: 50 }, { query: { queryKey: getListRequestHistoryQueryKey({ limit: 50 }) } });
  
  const deleteSaved = useDeleteSavedRequest();
  const clearHistory = useClearRequestHistory();

  const handleApplySaved = (req: any) => {
    setRequest({
      url: req.url,
      method: req.method as any,
      bearerToken: req.bearerToken || '',
      authHeaderName: req.authHeaderName || 'Authorization',
      headers: req.headers ? Object.entries(req.headers).map(([k,v], i) => ({ id: crypto.randomUUID(), key: k, value: String(v) })) : [],
      body: req.body || '',
      contentType: req.contentType || 'application/json'
    });
  };

  const handleApplyHistory = (entry: any) => {
    setRequest(prev => ({
      ...prev,
      url: entry.url,
      method: entry.method as any,
      headers: entry.requestHeaders ? Object.entries(entry.requestHeaders).map(([k,v], i) => ({ id: crypto.randomUUID(), key: k, value: String(v) })) : prev.headers,
    }));
  };

  const handleDeleteSaved = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteSaved.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedRequestsQueryKey() });
      }
    });
  };

  const handleClearHistory = () => {
    clearHistory.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRequestHistoryQueryKey({ limit: 50 }) });
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-card/50 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center px-4 py-2 border-b shrink-0 bg-muted/20">
          <Bookmark className="w-4 h-4 mr-2 text-primary" />
          <h2 className="text-xs font-semibold text-foreground tracking-wide">Saved Requests</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingSaved ? (
            <div className="text-xs text-muted-foreground p-2 font-mono">Loading...</div>
          ) : savedRequests?.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2 font-mono">No saved requests</div>
          ) : (
            savedRequests?.map(req => (
              <div 
                key={req.id} 
                className="group flex flex-col p-2 rounded-md hover:bg-accent cursor-pointer transition-colors border border-transparent hover:border-border"
                onClick={() => handleApplySaved(req)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate pr-2">{req.name}</span>
                  <button 
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    onClick={(e) => handleDeleteSaved(e, req.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn("text-[10px] font-mono font-bold", req.method === 'GET' ? 'text-primary' : req.method === 'POST' ? 'text-green-500' : 'text-orange-400')}>{req.method}</span>
                  <span className="text-xs font-mono text-muted-foreground truncate">{new URL(req.url || 'http://x').pathname}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden border-t">
        <div className="flex items-center justify-between px-4 py-2 border-b shrink-0 bg-muted/20">
          <div className="flex items-center">
            <History className="w-4 h-4 mr-2 text-primary" />
            <h2 className="text-xs font-semibold text-foreground tracking-wide">History</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={handleClearHistory} title="Clear History">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingHistory ? (
            <div className="text-xs text-muted-foreground p-2 font-mono">Loading...</div>
          ) : historyEntries?.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2 font-mono">No history</div>
          ) : (
            historyEntries?.map(entry => (
              <div 
                key={entry.id} 
                className="flex flex-col p-2 rounded-md hover:bg-accent cursor-pointer transition-colors border border-transparent hover:border-border"
                onClick={() => handleApplyHistory(entry)}
              >
                <div className="flex items-center gap-2">
                  <Badge variant={entry.status < 400 ? 'success' : 'error'} className="px-1 py-0 text-[9px] rounded-sm">
                    {entry.status}
                  </Badge>
                  <span className={cn("text-[10px] font-mono font-bold", entry.method === 'GET' ? 'text-primary' : entry.method === 'POST' ? 'text-green-500' : 'text-orange-400')}>{entry.method}</span>
                  <span className="text-[10px] font-mono text-muted-foreground truncate flex-1">{new URL(entry.url || 'http://x').pathname}</span>
                  <span className="text-[9px] text-muted-foreground shrink-0">{entry.durationMs}ms</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
