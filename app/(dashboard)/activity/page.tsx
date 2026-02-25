'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout';
import { Card, Button, Badge, EmptyState, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import {
  Activity as ActivityIcon,
  TrendingUp,
  FileText,
  PlayCircle,
  Download,
  Upload,
  Code,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  Calendar,
  Loader2,
  FolderKanban
} from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { activityService } from '@/services';
import type { Activity } from '@/types/api';

type DateFilter = 'today' | 'week' | 'month' | 'all';
type ActionFilter = 'all' | 'upload' | 'extraction' | 'export' | 'code_generation' | 'form_create' | 'project_create';

export default function ActivityPage() {
  const { selectedProject, projects } = useProject();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('week');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  useEffect(() => {
    fetchActivities();
  }, [selectedProject, dateFilter, actionFilter, projectFilter]);

  const fetchActivities = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await activityService.getAll({
        project_id: projectFilter !== 'all' ? projectFilter : undefined,
        action_type: actionFilter !== 'all' ? actionFilter : undefined,
        date_range: dateFilter,
      });
      setActivities(data);
    } catch (err: any) {
      console.error('Error fetching activities:', err);
      // Handle various error response formats
      let errorMessage = 'Failed to load activities';
      if (err.response?.data?.detail) {
        // If detail is a string, use it directly
        if (typeof err.response.data.detail === 'string') {
          errorMessage = err.response.data.detail;
        }
        // If detail is an array (Pydantic validation errors)
        else if (Array.isArray(err.response.data.detail)) {
          errorMessage = err.response.data.detail.map((e: any) => e.msg).join(', ');
        }
      } else if (err.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  };

  const getActivityIcon = (type: Activity['action_type']) => {
    switch (type) {
      case 'upload':
        return Upload;
      case 'extraction':
        return PlayCircle;
      case 'export':
        return Download;
      case 'code_generation':
        return Code;
      case 'form_create':
        return FileText;
      case 'project_create':
        return FolderKanban;
      default:
        return ActivityIcon;
    }
  };

  const getActivityColor = (type: Activity['action_type']) => {
    switch (type) {
      case 'upload':
        return { text: 'text-zinc-700 dark:text-zinc-300', bg: 'bg-zinc-100 dark:bg-zinc-800' };
      case 'extraction':
        return { text: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' };
      case 'export':
        return { text: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-900/30' };
      case 'code_generation':
        return { text: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-100 dark:bg-indigo-900/30' };
      case 'form_create':
        return { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' };
      case 'project_create':
        return { text: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-100 dark:bg-pink-900/30' };
      default:
        return { text: 'text-gray-600 dark:text-zinc-400', bg: 'bg-gray-100 dark:bg-[#1a1a1a]' };
    }
  };

  const getStatusBadge = (status?: Activity['status']) => {
    if (!status) return null;

    switch (status) {
      case 'success':
        return <Badge className="bg-green-100 text-green-800">Success</Badge>;
      case 'failed':
        return <Badge className="bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-400">Failed</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      default:
        return null;
    }
  };

  const filteredActivities = activities.filter(activity => {
    // Project filter
    if (projectFilter !== 'all' && activity.project_id !== projectFilter) {
      return false;
    }

    // Action filter
    if (actionFilter !== 'all' && activity.action_type !== actionFilter) {
      return false;
    }

    // Date filter
    const activityDate = new Date(activity.created_at);
    const now = new Date();

    switch (dateFilter) {
      case 'today':
        return activityDate.toDateString() === now.toDateString();
      case 'week':
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return activityDate >= weekAgo;
      case 'month':
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return activityDate >= monthAgo;
      case 'all':
      default:
        return true;
    }
  });

  const stats = {
    today: activities.filter(a => new Date(a.created_at).toDateString() === new Date().toDateString()).length,
    week: activities.filter(a => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return new Date(a.created_at) >= weekAgo;
    }).length,
    total: activities.length,
  };

  return (
    <DashboardLayout
      title="Activity Feed"
      description="View all recent activity across your projects"
    >
      <div className="space-y-6">
        {/* Activity Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-6 dark:bg-[#111111] dark:border-[#1f1f1f]">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-zinc-100 dark:bg-zinc-800 p-3">
                <ActivityIcon className="h-6 w-6 text-zinc-700 dark:text-zinc-300" />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{stats.today}</p>
                <p className="text-sm text-gray-600 dark:text-[#c0c0c0]">Actions Today</p>
              </div>
            </div>
          </Card>

          <Card className="p-6 dark:bg-[#111111] dark:border-[#1f1f1f]">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-3">
                <TrendingUp className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{stats.week}</p>
                <p className="text-sm text-gray-600 dark:text-[#c0c0c0]">This Week</p>
              </div>
            </div>
          </Card>

          <Card className="p-6 dark:bg-[#111111] dark:border-[#1f1f1f]">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-purple-100 dark:bg-purple-900/30 p-3">
                <ActivityIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{stats.total}</p>
                <p className="text-sm text-gray-600 dark:text-[#c0c0c0]">Total Activities</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Filters */}
        <Card className="p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-[#c0c0c0]">
              <Filter className="h-4 w-4" />
              Filters:
            </div>

            <div className="flex flex-col sm:flex-row gap-3 flex-1">
              {/* Date Filter */}
              <div className="flex-1">
                <label className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">Date Range</label>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#1a1a1a] dark:border-[#2a2a2a] dark:text-[#e0e0e0]"
                >
                  <option value="today">Today</option>
                  <option value="week">Last 7 Days</option>
                  <option value="month">Last 30 Days</option>
                  <option value="all">All Time</option>
                </select>
              </div>

              {/* Action Filter */}
              <div className="flex-1">
                <label className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">Action Type</label>
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#1a1a1a] dark:border-[#2a2a2a] dark:text-[#e0e0e0]"
                >
                  <option value="all">All Actions</option>
                  <option value="upload">Document Upload</option>
                  <option value="extraction">Extraction</option>
                  <option value="export">Export</option>
                  <option value="code_generation">Code Generation</option>
                  <option value="form_create">Form Creation</option>
                  <option value="project_create">Project Creation</option>
                </select>
              </div>

              {/* Project Filter */}
              <div className="flex-1">
                <label className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">Project</label>
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#1a1a1a] dark:border-[#2a2a2a] dark:text-[#e0e0e0]"
                >
                  <option value="all">All Projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDateFilter('week');
                setActionFilter('all');
                setProjectFilter('all');
              }}
            >
              Reset
            </Button>
          </div>
        </Card>

        {/* Activity Timeline */}
        <Card className="p-6 dark:bg-[#111111] dark:border-[#1f1f1f]">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold dark:text-white">Activity Timeline</h3>
            <div className="text-sm text-gray-500 dark:text-zinc-500">
              {filteredActivities.length} {filteredActivities.length === 1 ? 'activity' : 'activities'}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <XCircle className="h-12 w-12 text-purple-500 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Failed to Load Activities</h3>
              <p className="text-sm text-gray-600 dark:text-zinc-400 mb-4">{error}</p>
              <Button onClick={fetchActivities}>Try Again</Button>
            </div>
          ) : filteredActivities.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title="No activities found"
              description="No activities match your current filters"
            />
          ) : (
            <div className="space-y-4">
              {filteredActivities.map((activity, index) => {
                const Icon = getActivityIcon(activity.action_type);
                const colors = getActivityColor(activity.action_type);
                // Safely render metadata - ensure values are primitives
                const metadataText = activity.metadata && typeof activity.metadata === 'object'
                  ? Object.entries(activity.metadata)
                      .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' • ')
                  : null;

                return (
                  <div key={activity.id} className="flex gap-4">
                    {/* Timeline line */}
                    <div className="flex flex-col items-center">
                      <div className={cn('rounded-full p-2', colors.bg)}>
                        <Icon className={cn('h-5 w-5', colors.text)} />
                      </div>
                      {index < filteredActivities.length - 1 && (
                        <div className="w-0.5 flex-1 bg-gray-200 mt-2 min-h-[40px] dark:bg-[#1a1a1a]" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-6">
                      <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow dark:bg-[#0a0a0a] dark:border-[#1f1f1f]">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="text-base font-semibold text-gray-900 dark:text-white">{activity.action}</h4>
                            <p className="text-sm text-gray-600 mt-1 dark:text-[#c0c0c0]">{activity.description}</p>
                            {metadataText && (
                              <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">{metadataText}</p>
                            )}
                            <div className="flex items-center gap-3 mt-3">
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-gray-400 dark:text-zinc-500" />
                                <span className="text-xs text-gray-500 dark:text-zinc-500">
                                  {formatDate(activity.created_at)}
                                </span>
                              </div>
                              {activity.project_name && (
                                <div className="flex items-center gap-1.5">
                                  <FolderKanban className="h-3.5 w-3.5 text-gray-400 dark:text-zinc-500" />
                                  <span className="text-xs text-gray-500 dark:text-zinc-500">
                                    {activity.project_name}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="ml-4">
                            {getStatusBadge(activity.status)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}
