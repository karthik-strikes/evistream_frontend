'use client';

import { useProject } from '@/contexts/ProjectContext';
import { ChevronDown, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export function ProjectSelector() {
  const { projects, selectedProject, setSelectedProject } = useProject();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (projects.length === 0) {
    return (
      <button
        onClick={() => router.push('/projects')}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-gray-500 dark:text-zinc-400 hover:bg-gray-100/80 dark:hover:bg-white/5 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        <span>New Project</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-gray-100/80 dark:hover:bg-white/5 transition-colors max-w-[180px]"
      >
        <span className="text-xs font-medium text-gray-600 dark:text-zinc-300 truncate">
          {selectedProject?.name || 'Select Project'}
        </span>
        <ChevronDown className={cn("h-3 w-3 text-gray-400 dark:text-zinc-500 transition-transform shrink-0", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-[200px] bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#2a2a2a] rounded-lg shadow-lg z-50 max-h-[240px] overflow-y-auto py-1">
          {projects.map((project) => {
            const isActive = selectedProject?.id === project.id;
            return (
              <button
                key={project.id}
                onClick={() => {
                  setSelectedProject(project);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full px-3 py-1.5 text-left transition-colors flex items-center gap-2",
                  isActive
                    ? "bg-gray-50 dark:bg-white/[0.04]"
                    : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                )}
              >
                <span className={cn("text-xs truncate flex-1", isActive ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-600 dark:text-zinc-300")}>{project.name}</span>
                {isActive && <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
              </button>
            );
          })}
          <div className="h-px bg-gray-100 dark:bg-[#1f1f1f] my-1" />
          <button
            onClick={() => { router.push('/projects'); setIsOpen(false); }}
            className="w-full px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors flex items-center gap-2"
          >
            <Plus className="h-3 w-3 text-gray-400 dark:text-zinc-500" />
            <span className="text-xs font-medium text-gray-400 dark:text-zinc-500">Manage Projects</span>
          </button>
        </div>
      )}
    </div>
  );
}
