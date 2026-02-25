'use client';

import { useProject } from '@/contexts/ProjectContext';
import { FolderKanban, ChevronDown, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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
        className="flex items-center gap-2 px-4 py-2 bg-white border border-border rounded-lg hover:border-gray-400 transition-colors text-sm"
      >
        <Plus className="h-4 w-4" />
        <span>Create Project</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-4 py-2 bg-white border border-border rounded-lg hover:border-gray-400 transition-colors min-w-[200px]"
      >
        <FolderKanban className="h-4 w-4 text-gray-600" />
        <span className="text-sm font-medium flex-1 text-left truncate">
          {selectedProject?.name || 'Select Project'}
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-full min-w-[250px] bg-white border border-border rounded-lg shadow-lg z-50 max-h-[300px] overflow-y-auto">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => {
                setSelectedProject(project);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-border last:border-b-0 ${
                selectedProject?.id === project.id ? 'bg-gray-50' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <FolderKanban className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{project.name}</p>
                  {project.description && (
                    <p className="text-xs text-muted truncate">{project.description}</p>
                  )}
                </div>
                {selectedProject?.id === project.id && (
                  <div className="w-2 h-2 rounded-full bg-black flex-shrink-0" />
                )}
              </div>
            </button>
          ))}
          <button
            onClick={() => {
              router.push('/projects');
              setIsOpen(false);
            }}
            className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-t border-border text-sm font-medium text-gray-600"
          >
            <div className="flex items-center gap-3">
              <Plus className="h-4 w-4" />
              <span>Manage Projects</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
