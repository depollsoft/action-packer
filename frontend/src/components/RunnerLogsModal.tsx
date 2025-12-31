/**
 * RunnerLogsModal component - Display live logs for a specific runner
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  RefreshCw,
  Pause,
  Play,
  Download,
  Copy,
  Check,
  Radio,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { logsApi } from '../api';
import { useCopyToClipboard } from '../hooks';
import type { Runner, RunnerLogEntry } from '../types';

interface RunnerLogsModalProps {
  runner: Runner;
  onClose: () => void;
}

export function RunnerLogsModal({ runner, onClose }: RunnerLogsModalProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamLogs, setStreamLogs] = useState<RunnerLogEntry[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Use ref for isPaused to avoid closure issues in event handlers
  const isPausedRef = useRef(isPaused);
  const { copied, copyToClipboard } = useCopyToClipboard();
  
  // Keep ref in sync with state
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Fetch initial logs
  const { data: initialData, isLoading, refetch } = useQuery({
    queryKey: ['runner-logs', runner.id],
    queryFn: () => logsApi.getRunnerLogs(runner.id, { tail: 200 }),
    enabled: !isStreaming,
  });

  // Set up SSE streaming for real-time logs
  const startStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const apiBase = import.meta.env.VITE_API_URL || '';
    const url = `${apiBase}/api/logs/runner/${runner.id}/stream`;
    
    const eventSource = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = eventSource;
    setIsStreaming(true);
    setStreamError(null);
    setStreamLogs([]);

    eventSource.onmessage = (event) => {
      // Use ref to get current isPaused value (avoids closure issues)
      if (isPausedRef.current) return;
      
      try {
        const data = JSON.parse(event.data);
        
        if (data.error) {
          setStreamError(data.error);
          return;
        }
        
        if (data.info) {
          // Info message (e.g., "Container is not running")
          setStreamLogs((prev) => [
            ...prev,
            { timestamp: new Date().toISOString(), message: `[INFO] ${data.info}` },
          ]);
          return;
        }
        
        const entry: RunnerLogEntry = {
          timestamp: data.timestamp || new Date().toISOString(),
          message: data.message || '',
          stream: data.stream,
        };
        
        setStreamLogs((prev) => {
          const newLogs = [...prev, entry];
          // Keep max 1000 entries
          if (newLogs.length > 1000) {
            return newLogs.slice(-1000);
          }
          return newLogs;
        });
      } catch (error) {
        // Ignore parse errors in the UI, but log for debugging
        console.debug('Failed to parse runner log SSE message:', error);
      }
    };

    eventSource.onerror = () => {
      setStreamError('Connection lost. Click refresh to reconnect.');
      setIsStreaming(false);
      eventSource.close();
    };
  }, [runner.id, isPaused]);

  const stopStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamLogs, initialData, autoScroll]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  const handleRefresh = () => {
    if (isStreaming) {
      stopStreaming();
      setTimeout(startStreaming, 100);
    } else {
      refetch();
    }
  };

  const handleCopy = () => {
    const logs = isStreaming ? streamLogs : (initialData?.logs || []);
    const content = logs
      .map((l) => `${l.timestamp} ${l.message}`)
      .join('\n');
    copyToClipboard(content);
  };

  const handleDownload = () => {
    const logs = isStreaming ? streamLogs : (initialData?.logs || []);
    const content = logs
      .map((l) => `${l.timestamp} ${l.message}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `runner-${runner.name}-logs-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const logs = isStreaming ? streamLogs : (initialData?.logs || []);
  const canStream = runner.isolation_type === 'docker' || runner.runner_dir;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-forest-900 rounded-lg border border-forest-700 w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-forest-700">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              Runner Logs: {runner.name}
              {isStreaming && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <Radio className="h-3 w-3 animate-pulse" />
                  Live
                </span>
              )}
            </h2>
            <p className="text-sm text-muted mt-0.5">
              {runner.isolation_type === 'docker' ? 'Docker container' : 'Native runner'} • 
              {runner.status === 'online' ? ' Running' : runner.status === 'busy' ? ' Busy' : ' Offline'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Stream toggle */}
            {canStream && (
              <button
                onClick={isStreaming ? stopStreaming : startStreaming}
                className={`btn ${isStreaming ? 'btn-primary' : 'btn-secondary'} flex items-center gap-2`}
                title={isStreaming ? 'Stop streaming' : 'Start live streaming'}
              >
                {isStreaming ? (
                  <>
                    <WifiOff className="h-4 w-4" />
                    Stop Stream
                  </>
                ) : (
                  <>
                    <Wifi className="h-4 w-4" />
                    Live Stream
                  </>
                )}
              </button>
            )}

            {/* Pause/Play (only when streaming) */}
            {isStreaming && (
              <button
                onClick={() => setIsPaused(!isPaused)}
                className={`btn ${isPaused ? 'btn-primary' : 'btn-secondary'}`}
                title={isPaused ? 'Resume' : 'Pause'}
              >
                {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
            )}

            {/* Refresh */}
            <button onClick={handleRefresh} className="btn btn-secondary" title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </button>

            {/* Copy */}
            <button
              onClick={handleCopy}
              className={`btn ${copied ? 'btn-primary' : 'btn-secondary'}`}
              title={copied ? 'Copied!' : 'Copy logs to clipboard'}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>

            {/* Download */}
            <button onClick={handleDownload} className="btn btn-secondary" title="Download">
              <Download className="h-4 w-4" />
            </button>

            {/* Close */}
            <button onClick={onClose} className="btn btn-ghost" title="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Status bar */}
        <div className="px-4 py-2 bg-forest-800/50 text-sm flex items-center gap-4">
          <span className="text-muted">
            {logs.length} log entries
          </span>
          {isPaused && isStreaming && (
            <span className="flex items-center gap-1 text-yellow-400">
              <Pause className="h-3 w-3" />
              Paused
            </span>
          )}
          {streamError && (
            <span className="text-red-400">{streamError}</span>
          )}
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-emerald-400 hover:underline"
            >
              Jump to latest
            </button>
          )}
        </div>

        {/* Log container */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto bg-forest-950 min-h-0"
        >
          {isLoading && !isStreaming ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full"></div>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted">
              <p>No logs available</p>
              {runner.status === 'offline' && (
                <p className="text-xs mt-1">Start the runner to see logs</p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-forest-800/30">
              {logs.map((entry, index) => (
                <LogLine key={index} entry={entry} />
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: RunnerLogEntry }) {
  const timestamp = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const isError = entry.stream === 'stderr' || 
    entry.message.toLowerCase().includes('error') ||
    entry.message.toLowerCase().includes('fail');

  return (
    <div
      className={`flex items-start gap-2 py-1 px-3 font-mono text-xs hover:bg-forest-800/50 ${
        isError ? 'bg-red-900/10 text-red-300' : 'text-forest-200'
      }`}
    >
      <span className="text-forest-500 flex-shrink-0">{timestamp}</span>
      <span className="break-all whitespace-pre-wrap">{entry.message}</span>
    </div>
  );
}
