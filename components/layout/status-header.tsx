'use client';

import { useEffect, useState } from 'react';
import { Bell, CheckCircle2, AlertCircle, Loader2, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { useRouter } from 'next/navigation';
import { healthService, jobsService } from '@/services';
import { useProject } from '@/contexts/ProjectContext';

interface StatusHeaderProps {
  onNotificationClick?: () => void;
  notificationCount?: number;
}

export function StatusHeader({ onNotificationClick, notificationCount = 0 }: StatusHeaderProps) {
  const router = useRouter();
  const { selectedProject } = useProject();
  const [backendStatus, setBackendStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [activeJobs, setActiveJobs] = useState(0);

  // Check backend health
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const isConnected = await healthService.isBackendConnected();
        setBackendStatus(isConnected ? 'online' : 'offline');
      } catch {
        setBackendStatus('offline');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  // Monitor active jobs
  useEffect(() => {
    if (!selectedProject) return;

    const fetchActiveJobs = async () => {
      try {
        const jobs = await jobsService.getAll(selectedProject.id);
        const running = jobs.filter(j => j.status === 'processing' || j.status === 'pending').length;
        setActiveJobs(running);
      } catch {
        setActiveJobs(0);
      }
    };

    fetchActiveJobs();
    const interval = setInterval(fetchActiveJobs, 5000); // Check every 5s
    return () => clearInterval(interval);
  }, [selectedProject]);

  const getStatusColor = () => {
    switch (backendStatus) {
      case 'online':
        return 'text-green-600';
      case 'offline':
        return 'text-red-600';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusIcon = () => {
    switch (backendStatus) {
      case 'online':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'offline':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Loader2 className="h-4 w-4 animate-spin" />;
    }
  };

  const getStatusText = () => {
    switch (backendStatus) {
      case 'online':
        return 'Online';
      case 'offline':
        return 'Offline';
      default:
        return 'Checking...';
    }
  };

  return (
    <div className="flex items-center gap-4">
      {/* Active Jobs Indicator */}
      {activeJobs > 0 && (
        <button
          onClick={() => router.push('/jobs')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 transition-colors border border-zinc-300"
          title="View active jobs"
        >
          <Loader2 className="h-4 w-4 text-zinc-600 animate-spin" />
          <span className="text-sm font-medium text-zinc-900">
            {activeJobs} {activeJobs === 1 ? 'job' : 'jobs'} running
          </span>
        </button>
      )}

      {/* Backend Status */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors',
          backendStatus === 'online'
            ? 'bg-green-50 border-green-200'
            : backendStatus === 'offline'
            ? 'bg-red-50 border-red-200'
            : 'bg-gray-50 border-gray-200'
        )}
        title="Backend server status"
      >
        <div className={getStatusColor()}>{getStatusIcon()}</div>
        <span className="text-sm font-medium text-gray-900">{getStatusText()}</span>
      </div>

      {/* Notifications Bell */}
      <button
        onClick={onNotificationClick}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
        title="Notifications"
      >
        <Bell className="h-5 w-5 text-gray-600" />
        {notificationCount > 0 && (
          <Badge
            className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-red-500 text-white border-2 border-white"
          >
            {notificationCount > 9 ? '9+' : notificationCount}
          </Badge>
        )}
      </button>

      {/* Activity Monitor Link */}
      <button
        onClick={() => router.push('/activity')}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        title="View activity"
      >
        <Activity className="h-5 w-5 text-gray-600" />
      </button>
    </div>
  );
}
