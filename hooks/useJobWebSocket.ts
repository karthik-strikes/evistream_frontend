import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSMessage } from '@/types/api';

const WS_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
  .replace(/^http/, 'ws');

interface UseJobWebSocketOptions {
  jobId: string | null;
  onMessage?: (message: WSMessage) => void;
  onStatusChange?: (status: string) => void;
  onProgress?: (progress: number) => void;
  enabled?: boolean;
}

interface UseJobWebSocketReturn {
  connected: boolean;
  lastMessage: WSMessage | null;
}

export function useJobWebSocket({
  jobId,
  onMessage,
  onStatusChange,
  onProgress,
  enabled = true,
}: UseJobWebSocketOptions): UseJobWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);

  // Stable callback refs
  const onMessageRef = useRef(onMessage);
  const onStatusChangeRef = useRef(onStatusChange);
  const onProgressRef = useRef(onProgress);
  onMessageRef.current = onMessage;
  onStatusChangeRef.current = onStatusChange;
  onProgressRef.current = onProgress;

  const connect = useCallback(() => {
    if (!jobId || !enabled) return;

    const token = typeof window !== 'undefined'
      ? localStorage.getItem('auth_token')
      : null;

    const url = `${WS_BASE_URL}/api/v1/ws/jobs/${jobId}${token ? `?token=${token}` : ''}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data: WSMessage = JSON.parse(event.data);

        // Ignore heartbeats and pongs
        if ((data as any).type === 'heartbeat' || (data as any).type === 'pong' || (data as any).type === 'connected') {
          return;
        }

        setLastMessage(data);
        onMessageRef.current?.(data);

        if (data.status) {
          onStatusChangeRef.current?.(data.status);
        }
        if (data.progress !== undefined) {
          onProgressRef.current?.(data.progress);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3 seconds if still enabled
      if (enabled && jobId) {
        reconnectTimerRef.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [jobId, enabled]);

  useEffect(() => {
    connect();

    return () => {
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connected, lastMessage };
}
