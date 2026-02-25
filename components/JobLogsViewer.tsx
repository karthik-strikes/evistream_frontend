/**
 * JobLogsViewer Component
 *
 * Displays real-time logs from a job using WebSocket connection.
 *
 * Usage:
 * ```tsx
 * <JobLogsViewer jobId="uuid-here" />
 * ```
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { connectToJobLogs, LogMessage, JobLogsWebSocket } from '@/services/jobLogsWebSocket';

interface JobLogsViewerProps {
  jobId: string;
  autoScroll?: boolean;
  showTimestamps?: boolean;
  maxLogs?: number;
}

export function JobLogsViewer({
  jobId,
  autoScroll = true,
  showTimestamps = true,
  maxLogs = 500
}: JobLogsViewerProps) {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<JobLogsWebSocket | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('auth_token') || undefined : undefined;
    // Connect to WebSocket
    const ws = connectToJobLogs(jobId, {
      onConnected: () => {
        setIsConnected(true);
      },

      onDisconnected: () => {
        setIsConnected(false);
      },

      onLog: (log) => {
        setLogs((prev) => {
          const newLogs = [...prev, log];
          return newLogs.length > maxLogs ? newLogs.slice(-maxLogs) : newLogs;
        });
      },

      onProgress: (progress) => {
        setProgress(progress.progress || 0);
        if (progress.message) {
          setLogs((prev) => [...prev, progress]);
        }
      },

      onStage: (stage) => {
        setCurrentStage(stage.stage || stage.message);
        setLogs((prev) => [...prev, stage]);
      },

      onData: (data) => {
        setLogs((prev) => [...prev, data]);
      },

      onComplete: (complete) => {
        setProgress(100);
        setLogs((prev) => [...prev, { ...complete, level: 'success' }]);
      },

      onError: (error) => {
        setLogs((prev) => [...prev, error]);
      },
    }, token);

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, [jobId, maxLogs]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString();
    } catch {
      return timestamp;
    }
  };

  const getLogColor = (level?: string) => {
    switch (level) {
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      case 'warning':
        return 'text-yellow-600';
      case 'info':
      default:
        return 'text-gray-700';
    }
  };

  const getLogIcon = (type: string, level?: string) => {
    if (type === 'progress') return '⏳';
    if (type === 'stage') return '📍';
    if (type === 'data') return '📊';
    if (type === 'complete') return '✅';

    switch (level) {
      case 'success':
        return '✓';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      default:
        return '•';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-semibold">Job Progress</h3>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-500">
              {isConnected ? 'Live' : 'Disconnected'}
            </span>
          </div>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            {isExpanded ? 'Hide Details ▲' : 'Show Details ▼'}
          </button>
        </div>

        {/* Progress Bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-600">{currentStage || 'Processing...'}</span>
            <span className="font-semibold">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Logs */}
      {isExpanded && (
        <div className="p-4">
          <div className="bg-gray-50 rounded border border-gray-200 p-3 max-h-96 overflow-y-auto">
            {logs.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                Waiting for logs...
              </div>
            ) : (
              <div className="space-y-1 font-mono text-sm">
                {logs.map((log, index) => (
                  <div key={index} className={`flex items-start space-x-2 ${getLogColor(log.level)}`}>
                    <span className="flex-shrink-0">{getLogIcon(log.type, log.level)}</span>
                    {showTimestamps && (
                      <span className="text-gray-400 flex-shrink-0">
                        {formatTimestamp(log.timestamp)}
                      </span>
                    )}
                    <span className="flex-1 break-words">{log.message}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>{logs.length} log entries</span>
            <button
              onClick={() => setLogs([])}
              className="text-blue-600 hover:text-blue-800"
            >
              Clear logs
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
