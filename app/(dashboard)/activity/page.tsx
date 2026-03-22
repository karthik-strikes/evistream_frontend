'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout';
import { Card, Button, EmptyState } from '@/components/ui';
import { Activity as ActivityIcon, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import { activityService } from '@/services';
import type { Activity } from '@/types/api';
import { ActivityTimelineItem, ActivityStatsPanel, ActivityFilterBar } from '@/components/activity';

type TabValue = 'all' | 'upload' | 'extraction' | 'forms';
type DateRange = 'today' | 'week' | 'month' | 'all';

const ITEMS_PER_PAGE = 15;

function getActionTypeParam(tab: TabValue): string | undefined {
  switch (tab) {
    case 'upload': return 'upload';
    case 'extraction': return 'extraction';
    case 'forms': return 'form_create';
    default: return undefined;
  }
}

export default function ActivityPage() {
  const { selectedProject, projects } = useProject();
  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [dateRange, setDateRange] = useState<DateRange>('week');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [page, setPage] = useState(0);

  // Reset page when filters change
  const handleTabChange = (tab: TabValue) => { setActiveTab(tab); setPage(0); };
  const handleDateChange = (range: DateRange) => { setDateRange(range); setPage(0); };
  const handleProjectChange = (id: string) => { setProjectFilter(id); setPage(0); };

  const { data: rawActivities = [], isLoading, isFetching } = useQuery({
    queryKey: ['activities', projectFilter, activeTab, dateRange, page],
    queryFn: () => activityService.getAll({
      project_id: projectFilter !== 'all' ? projectFilter : undefined,
      action_type: getActionTypeParam(activeTab),
      date_range: dateRange,
      limit: ITEMS_PER_PAGE + 1,
      offset: page * ITEMS_PER_PAGE,
    }),
  });

  // For the "forms" tab, also include code_generation activities client-side
  // since the API only supports a single action_type filter
  const hasMore = rawActivities.length > ITEMS_PER_PAGE;
  const activities = rawActivities.slice(0, ITEMS_PER_PAGE);

  const handleResetFilters = () => {
    setActiveTab('all');
    setDateRange('week');
    setProjectFilter('all');
    setPage(0);
  };

  return (
    <DashboardLayout
      title="Activity Log"
      description="Track what has happened across your projects"
    >
      <div className="space-y-6">
        <ActivityStatsPanel activities={activities} />

        <ActivityFilterBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          dateRange={dateRange}
          onDateRangeChange={handleDateChange}
          projectFilter={projectFilter}
          onProjectFilterChange={handleProjectChange}
          projects={projects}
        />

        <Card className="p-6 dark:bg-[#111111] dark:border-[#1f1f1f]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : activities.length === 0 ? (
            <div className="py-8 text-center">
              {activeTab === 'all' && dateRange === 'week' && projectFilter === 'all' ? (
                <EmptyState
                  icon={ActivityIcon}
                  title="No activity yet"
                  description="As you work with your projects, uploads, extractions, and form changes will appear here."
                />
              ) : (
                <div className="space-y-3">
                  <EmptyState
                    icon={ActivityIcon}
                    title="No matching activity"
                    description="Try expanding your date range or changing the filter."
                  />
                  <Button variant="secondary" size="sm" onClick={handleResetFilters}>
                    Reset filters
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              {isFetching && !isLoading && (
                <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500 mb-3">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Refreshing...</span>
                </div>
              )}

              <div>
                {activities.map((activity, index) => (
                  <ActivityTimelineItem
                    key={activity.id}
                    activity={activity}
                    isLast={index === activities.length - 1}
                  />
                ))}
              </div>

              {/* Pagination */}
              {(page > 0 || hasMore) && (
                <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-[#1f1f1f] mt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-xs text-gray-400 dark:text-zinc-500">
                    Page {page + 1}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={!hasMore}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}
