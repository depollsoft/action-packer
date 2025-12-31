/**
 * LogViewer component - Live log streaming for the application
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ScrollText,
  RefreshCw,
  Pause,
  Play,
  Download,
  Copy,
  Check,
  Filter,
  ChevronDown,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
} from 'lucide-react';
import { logsApi } from '../api';
import { useWebSocket, useCopyToClipboard } from '../hooks';
import type { LogEntry, LogLevel } from '../types';

const levelColors: Record<LogLevel, string> = {
  error: 'text-red-400',
  warn: 'text-yellow-400',
  info: 'text-blue-400',
  debug: 'text-gray-400',
};

const levelIcons: Record<LogLevel, React.ComponentType<{ className?: string }>> = {
  error: AlertCircle,
  warn: AlertTriangle,
  info: Info,
  debug: Bug,
};

const levelBgColors: Record<LogLevel, string> = {
  error: 'bg-red-900/20 border-l-2 border-red-500',
  warn: 'bg-yellow-900/20 border-l-2 border-yellow-500',
  info: '',
  debug: 'bg-gray-900/20',
};

function LogLine({ entry }: { entry: LogEntry }) {
  const Icon = levelIcons[entry.level];
  const timestamp = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });

  return (
    <div
      className={`flex items-start gap-2 py-1 px-2 font-mono text-sm ${levelBgColors[entry.level]} hover:bg-forest-800/50`}
    >
      <span className="text-forest-500 flex-shrink-0 w-24">{timestamp}</span>
      <Icon className={`h-4 w-4 flex-shrink-0 mt-0.5 ${levelColors[entry.level]}`} />
      <span className={`${levelColors[entry.level]} uppercase text-xs font-bold w-12 flex-shrink-0`}>
        {entry.level}
      </span>
      <span className="text-forest-200 break-all whitespace-pre-wrap">{entry.message}</span>
    </div>
  );
}

export function LogViewer() {
  const [isPaused, setIsPaused] = useState(false);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastId, setLastId] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const queryClient = useQueryClient();
  const { lastMessage } = useWebSocket();
  const { copied, copyToClipboard } = useCopyToClipboard();

  // Close filter menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilterMenu(false);
      }
    }
    
    if (showFilterMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showFilterMenu]);

  // Initial load of logs
  const { isLoading } = useQuery({
    queryKey: ['logs', 'initial'],
    queryFn: async () => {
      const response = await logsApi.list({ limit: 500 });
      setLogs(response.logs);
      setLastId(response.lastId);
      return response;
    },
    refetchOnWindowFocus: false,
  });

  // Handle WebSocket messages for real-time log updates
  useEffect(() => {
    if (lastMessage && lastMessage.type === 'log_entry' && !isPaused) {
      const entry = lastMessage.data as LogEntry;
      setLogs((prev) => {
        const newLogs = [...prev, entry];
        // Keep max 2000 entries in memory
        if (newLogs.length > 2000) {
          return newLogs.slice(-2000);
        }
        return newLogs;
      });
      setLastId(entry.id);
    }
  }, [lastMessage, isPaused]);

  // Poll for new logs as fallback (in case WebSocket misses some)
  useEffect(() => {
    if (isPaused || lastId === 0) return;

    const interval = setInterval(async () => {
      try {
        const response = await logsApi.list({ since: lastId });
        if (response.logs.length > 0) {
          setLogs((prev) => {
            const existingIds = new Set(prev.map((l) => l.id));
            const newLogs = response.logs.filter((l) => !existingIds.has(l.id));
            if (newLogs.length === 0) return prev;
            const combined = [...prev, ...newLogs];
            if (combined.length > 2000) {
              return combined.slice(-2000);
            }
            return combined;
          });
          setLastId(response.lastId);
        }
      } catch (error) {
        // Log polling errors for debugging but don't disrupt the UI
        console.debug('Log polling error (ignored):', error);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [lastId, isPaused]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['logs'] });
  };

  const handleCopy = () => {
    const filteredLogs = filter === 'all' ? logs : logs.filter((l) => l.level === filter);
    const content = filteredLogs
      .map((l) => `${l.timestamp} [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    copyToClipboard(content);
  };

  const handleDownload = () => {
    const filteredLogs = filter === 'all' ? logs : logs.filter((l) => l.level === filter);
    const content = filteredLogs
      .map((l) => `${l.timestamp} [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `action-packer-logs-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = filter === 'all' ? logs : logs.filter((l) => l.level === filter);

  const logCounts = logs.reduce(
    (acc, log) => {
      acc[log.level] = (acc[log.level] || 0) + 1;
      return acc;
    },
    {} as Record<LogLevel, number>
  );

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText className="h-6 w-6" />
            Application Logs
          </h1>
          <p className="text-muted mt-1">Live log stream from the Action Packer server</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Log level counts */}
          <div className="flex items-center gap-3 mr-4 text-sm">
            {logCounts.error > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <AlertCircle className="h-4 w-4" />
                {logCounts.error}
              </span>
            )}
            {logCounts.warn > 0 && (
              <span className="flex items-center gap-1 text-yellow-400">
                <AlertTriangle className="h-4 w-4" />
                {logCounts.warn}
              </span>
            )}
          </div>

          {/* Filter dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowFilterMenu(false);
              }}
              className="btn btn-secondary flex items-center gap-2"
              aria-haspopup="menu"
              aria-expanded={showFilterMenu}
            >
              <Filter className="h-4 w-4" />
              {filter === 'all' ? 'All Levels' : filter.toUpperCase()}
              <ChevronDown className="h-4 w-4" />
            </button>

            {showFilterMenu && (
              <div 
                className="absolute right-0 top-full mt-1 w-40 bg-forest-800 border border-forest-600 rounded-md shadow-lg z-10"
                role="menu"
                aria-orientation="vertical"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setShowFilterMenu(false);
                }}
              >
                {(['all', 'error', 'warn', 'info', 'debug'] as const).map((level) => (
                  <button
                    key={level}
                    role="menuitem"
                    onClick={() => {
                      setFilter(level);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-forest-700 ${
                      filter === level ? 'bg-forest-700' : ''
                    }`}
                  >
                    {level === 'all' ? 'All Levels' : level.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pause/Play */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`btn ${isPaused ? 'btn-primary' : 'btn-secondary'}`}
            title={isPaused ? 'Resume live updates' : 'Pause live updates'}
          >
            {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>

          {/* Refresh */}
          <button onClick={handleRefresh} className="btn btn-secondary" title="Refresh logs">
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
          <button onClick={handleDownload} className="btn btn-secondary" title="Download logs">
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted">
          Showing {filteredLogs.length} of {logs.length} entries
        </span>
        {isPaused && (
          <span className="flex items-center gap-1 text-yellow-400">
            <Pause className="h-3 w-3" />
            Paused
          </span>
        )}
        {!autoScroll && !isPaused && (
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
        className="flex-1 overflow-auto bg-forest-950 rounded-lg border border-forest-700 min-h-0"
        style={{ maxHeight: 'calc(100vh - 280px)' }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full"></div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted">
            <ScrollText className="h-8 w-8 mb-2" />
            <p>No logs available</p>
          </div>
        ) : (
          <div className="divide-y divide-forest-800/50">
            {filteredLogs.map((entry) => (
              <LogLine key={entry.id} entry={entry} />
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
