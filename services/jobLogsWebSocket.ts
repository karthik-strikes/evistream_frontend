/**
 * WebSocket client for real-time job log streaming
 *
 * Usage:
 * ```typescript
 * const ws = connectToJobLogs(jobId, {
 *   onLog: (log) => console.log(log.message),
 *   onProgress: (progress) => setProgress(progress.progress),
 *   onComplete: () => showSuccess(),
 *   onError: (error) => showError(error)
 * });
 *
 * // Later: ws.close();
 * ```
 */

export interface LogMessage {
  type: 'log' | 'progress' | 'stage' | 'data' | 'error' | 'complete' | 'connected' | 'heartbeat';
  level?: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
  job_id: string;
  progress?: number;
  stage?: string;
  data?: Record<string, any>;
}

export interface JobLogsCallbacks {
  onLog?: (log: LogMessage) => void;
  onProgress?: (progress: LogMessage) => void;
  onStage?: (stage: LogMessage) => void;
  onData?: (data: LogMessage) => void;
  onComplete?: (data: LogMessage) => void;
  onError?: (error: LogMessage) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class JobLogsWebSocket {
  private ws: WebSocket | null = null;
  private jobId: string;
  private callbacks: JobLogsCallbacks;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private isIntentionallyClosed = false;

  constructor(jobId: string, callbacks: JobLogsCallbacks) {
    this.jobId = jobId;
    this.callbacks = callbacks;
  }

  connect(token?: string): void {
    this.isIntentionallyClosed = false;

    const wsUrl = this.buildWebSocketUrl();
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      // Send auth token as first message instead of URL query param
      if (token) {
        this.ws!.send(JSON.stringify({ type: 'auth', token }));
      }
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.callbacks.onConnected?.();
    };

    this.ws.onmessage = (event) => {
      try {
        const message: LogMessage = JSON.parse(event.data);
        this.handleMessage(message);
      } catch {
        // Ignore parse errors
      }
    };

    this.ws.onerror = () => {
      // Error handled by onclose
    };

    this.ws.onclose = () => {
      this.callbacks.onDisconnected?.();

      // Attempt reconnection if not intentionally closed
      if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(token), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // Exponential backoff, capped at 30s
      }
    };
  }

  private buildWebSocketUrl(): string {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const isLocal = /localhost|127\.0\.0\.1/.test(apiUrl);
    let wsBase: string;
    if (!isLocal && apiUrl.startsWith('http://')) {
      wsBase = apiUrl.replace(/^http:\/\//, 'wss://');
    } else {
      wsBase = apiUrl.replace(/^https?/, (s) => (s === 'https' ? 'wss' : 'ws'));
    }
    return `${wsBase}/api/v1/ws/jobs/${this.jobId}`;
  }

  private handleMessage(message: LogMessage): void {
    switch (message.type) {
      case 'log':
        this.callbacks.onLog?.(message);
        break;

      case 'progress':
        this.callbacks.onProgress?.(message);
        break;

      case 'stage':
        this.callbacks.onStage?.(message);
        break;

      case 'data':
        this.callbacks.onData?.(message);
        break;

      case 'complete':
        this.callbacks.onComplete?.(message);
        break;

      case 'error':
        this.callbacks.onError?.(message);
        break;

      case 'connected':
        break;

      case 'heartbeat':
        // Keep-alive ping from server
        break;

      default:
        break;
    }
  }

  send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  ping(): void {
    this.send({ type: 'ping' });
  }

  close(): void {
    this.isIntentionallyClosed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

/**
 * Convenience function to connect to job logs
 */
export function connectToJobLogs(
  jobId: string,
  callbacks: JobLogsCallbacks,
  token?: string
): JobLogsWebSocket {
  const ws = new JobLogsWebSocket(jobId, callbacks);
  ws.connect(token);
  return ws;
}
