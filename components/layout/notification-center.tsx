'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, CheckCircle2, AlertCircle, Info, Loader2, Clock, PlayCircle, FileText, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { notificationsService } from '@/services';
import type { Notification } from '@/types/api';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const data = await notificationsService.getAll();
      setNotifications(data);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await notificationsService.markAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, read: true } : n))
      );
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await notificationsService.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  const clearAll = async () => {
    try {
      await notificationsService.deleteAll();
      setNotifications([]);
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  };

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      case 'warning':
        return <AlertCircle className="h-5 w-5 text-yellow-600" />;
      default:
        return <Info className="h-5 w-5 text-zinc-700" />;
    }
  };

  const getBackgroundColor = (type: Notification['type'], read: boolean) => {
    if (read) return 'bg-white';
    switch (type) {
      case 'success':
        return 'bg-green-50';
      case 'error':
        return 'bg-red-50';
      case 'warning':
        return 'bg-yellow-50';
      default:
        return 'bg-zinc-50';
    }
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Slide-out Panel */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-full sm:w-96 bg-white shadow-2xl z-50 transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold">Notifications</h2>
            {unreadCount > 0 && (
              <p className="text-sm text-gray-500">{unreadCount} unread</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Actions */}
        {notifications.length > 0 && (
          <div className="flex items-center gap-2 p-4 border-b border-gray-200 bg-gray-50">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllAsRead}>
                Mark all as read
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        )}

        {/* Notifications List */}
        <div className="overflow-y-auto h-[calc(100vh-140px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="rounded-full bg-gray-100 p-4 mb-4">
                <CheckCircle2 className="h-12 w-12 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                All caught up!
              </h3>
              <p className="text-sm text-gray-500">
                No new notifications right now
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={cn(
                    'p-4 transition-colors hover:bg-gray-50 cursor-pointer',
                    getBackgroundColor(notification.type, notification.read),
                    !notification.read && 'border-l-4 border-l-zinc-400'
                  )}
                  onClick={() => markAsRead(notification.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {getIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-semibold text-gray-900">
                          {notification.title}
                        </h4>
                        {!notification.read && (
                          <div className="flex-shrink-0 w-2 h-2 bg-zinc-700 rounded-full mt-1" />
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {notification.message}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-gray-500">
                          {formatDate(notification.created_at)}
                        </span>
                      </div>
                      {notification.action_label && notification.action_url && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-3"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Safe navigation using Next.js router (prevents open redirect/XSS)
                            if (notification.action_url?.startsWith('/')) {
                              router.push(notification.action_url);
                              onClose();
                            }
                          }}
                        >
                          {notification.action_label}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Activity Timeline Component for Activity Page
export function ActivityTimeline() {
  const activities = [
    {
      id: '1',
      type: 'extraction',
      icon: PlayCircle,
      title: 'Extraction Completed',
      description: 'Job #123 finished successfully',
      metadata: '15 results extracted',
      timestamp: new Date(Date.now() - 2 * 60 * 1000),
      color: 'text-green-600',
      bgColor: 'bg-green-100',
    },
    {
      id: '2',
      type: 'upload',
      icon: FileText,
      title: 'Document Uploaded',
      description: 'research_paper.pdf',
      metadata: '2.4 MB',
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      color: 'text-zinc-700',
      bgColor: 'bg-zinc-100',
    },
    {
      id: '3',
      type: 'export',
      icon: Download,
      title: 'Results Exported',
      description: 'Downloaded results.csv',
      metadata: '15 rows',
      timestamp: new Date(Date.now() - 10 * 60 * 1000),
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
    },
  ];

  return (
    <div className="space-y-4">
      {activities.map((activity, index) => {
        const Icon = activity.icon;
        return (
          <div key={activity.id} className="flex gap-4">
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div className={cn('rounded-full p-2', activity.bgColor)}>
                <Icon className={cn('h-5 w-5', activity.color)} />
              </div>
              {index < activities.length - 1 && (
                <div className="w-0.5 h-full bg-gray-200 mt-2" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-8">
              <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <h4 className="font-semibold text-gray-900">{activity.title}</h4>
                <p className="text-sm text-gray-600 mt-1">{activity.description}</p>
                {activity.metadata && (
                  <p className="text-xs text-gray-500 mt-1">{activity.metadata}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <Clock className="h-3 w-3 text-gray-400" />
                  <span className="text-xs text-gray-500">
                    {formatDate(activity.timestamp.toISOString())}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
