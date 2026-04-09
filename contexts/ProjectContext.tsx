'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { projectsService } from '@/services';
import { projectMembersService } from '@/services/project-members.service';
import { Project as APIProject, CreateProjectRequest, MyPermissionsResponse } from '@/types/api';
import { getErrorMessage } from '@/lib/utils';
import { apiClient } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// Re-export Project type from API
export type Project = APIProject;

interface ProjectContextType {
  projects: Project[];
  selectedProject: Project | null;
  loading: boolean;
  error: string | null;
  setSelectedProject: (project: Project | null) => void;
  createProject: (name: string, description?: string) => Promise<Project>;
  updateProject: (id: string, updates: Partial<CreateProjectRequest>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  myPermissions: MyPermissionsResponse | null;
  isOwner: boolean;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

function safeGetItem(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.error('localStorage write failed:', e);
  }
}

function safeRemoveItem(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// Synchronously restore from localStorage to avoid "No Project Selected" flash on refresh
function getInitialProjects(): Project[] {
  const stored = safeGetItem('projects');
  if (stored) {
    try { return JSON.parse(stored); } catch { /* ignore */ }
  }
  return [];
}

function getInitialSelectedProject(projects: Project[]): Project | null {
  const storedId = safeGetItem('selectedProjectId');
  if (storedId && projects.length > 0) {
    const found = projects.find((p) => p.id === storedId);
    if (found) return found;
  }
  return projects.length > 0 ? projects[0] : null;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { loading: authLoading } = useAuth();
  // Synchronously restore state from localStorage on mount to avoid
  // "No Project Selected" flash on page refresh
  const [{ initialProjects, initialSelected }] = useState(() => {
    const p = getInitialProjects();
    const s = getInitialSelectedProject(p);
    return { initialProjects: p, initialSelected: s };
  });
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [selectedProject, setSelectedProjectState] = useState<Project | null>(initialSelected);
  const [loading, setLoading] = useState(!initialSelected);
  const [error, setError] = useState<string | null>(null);
  const [myPermissions, setMyPermissions] = useState<MyPermissionsResponse | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const refreshInFlight = useRef(false);

  const refreshProjects = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    // Only show loading if we have no cached projects (avoids flash on background refresh)
    if (!safeGetItem('projects')) setLoading(true);
    setError(null);
    try {
      const data = await projectsService.getAll();
      setProjects(data);
      safeSetItem('projects', JSON.stringify(data));
    } catch (err: unknown) {
      console.error('Failed to fetch projects:', err);
      setError('Failed to load projects');

      // Fallback to localStorage
      const stored = safeGetItem('projects');
      if (stored) {
        try {
          setProjects(JSON.parse(stored));
        } catch (e) {
          console.error('Failed to parse stored projects:', e);
        }
      }
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  }, []);

  // Load projects from API once auth has finished loading
  useEffect(() => {
    if (authLoading) return;
    const token = apiClient.getToken();
    if (token) {
      refreshProjects();
    } else {
      setLoading(false);
    }
  }, [authLoading, refreshProjects]);

  // Restore selected project from localStorage
  useEffect(() => {
    if (projects.length > 0) {
      const storedId = safeGetItem('selectedProjectId');
      if (storedId) {
        const project = projects.find((p) => p.id === storedId);
        if (project) {
          setSelectedProjectState(project);
          return;
        }
      }
      // Auto-select first project if no valid stored selection
      setSelectedProjectState(projects[0]);
    } else {
      setSelectedProjectState(null);
    }
  }, [projects]);

  // Fetch permissions for selected project (with in-memory cache)
  const permsCacheRef = useRef<Record<string, MyPermissionsResponse>>({});
  useEffect(() => {
    if (!selectedProject) {
      setMyPermissions(null);
      setIsOwner(false);
      return;
    }
    const token = apiClient.getToken();
    if (!token) return;

    // Return cached permissions immediately if available
    const cached = permsCacheRef.current[selectedProject.id];
    if (cached) {
      setMyPermissions(cached);
      setIsOwner(cached.is_owner);
      return;
    }

    projectMembersService.getMyPermissions(selectedProject.id)
      .then((perms) => {
        permsCacheRef.current[selectedProject.id] = perms;
        setMyPermissions(perms);
        setIsOwner(perms.is_owner);
      })
      .catch((err: unknown) => {
        console.error('Failed to fetch permissions:', err);
        const fallback: MyPermissionsResponse = {
          is_owner: false,
          is_admin: false,
          role: 'member',
          can_view_docs: true,
          can_upload_docs: false,
          can_create_forms: false,
          can_run_extractions: false,
          can_view_results: true,
          can_adjudicate: false,
          can_qa_review: false,
          can_manage_assignments: false,
          can_manage_members: false,
        };
        setMyPermissions(fallback);
        setIsOwner(false);
      });
  }, [selectedProject]);

  const createProject = useCallback(async (name: string, description?: string): Promise<Project> => {
    const request: CreateProjectRequest = { name, description };

    try {
      const newProject = await projectsService.create(request);
      setProjects((prev) => {
        const updated = [newProject, ...prev];
        safeSetItem('projects', JSON.stringify(updated));
        return updated;
      });
      setSelectedProjectState(newProject);
      return newProject;
    } catch (err: unknown) {
      console.error('Failed to create project:', err);
      throw new Error(getErrorMessage(err, 'Failed to create project'));
    }
  }, []);

  const updateProject = useCallback(async (
    id: string,
    updates: Partial<CreateProjectRequest>
  ): Promise<void> => {
    try {
      const updated = await projectsService.update(id, updates);

      setProjects((prev) => {
        const newProjects = prev.map((p) => (p.id === id ? updated : p));
        safeSetItem('projects', JSON.stringify(newProjects));
        return newProjects;
      });

      setSelectedProjectState((prev) => (prev?.id === id ? updated : prev));
    } catch (err: unknown) {
      console.error('Failed to update project:', err);
      throw new Error(getErrorMessage(err, 'Failed to update project'));
    }
  }, []);

  const deleteProject = useCallback(async (id: string): Promise<void> => {
    try {
      await projectsService.delete(id);

      setProjects((prev) => {
        const remaining = prev.filter((p) => p.id !== id);
        safeSetItem('projects', JSON.stringify(remaining));
        return remaining;
      });

      setSelectedProjectState((prev) => {
        if (prev?.id === id) {
          // Will be resolved by the useEffect on projects change
          return null;
        }
        return prev;
      });
    } catch (err: unknown) {
      console.error('Failed to delete project:', err);
      throw new Error(getErrorMessage(err, 'Failed to delete project'));
    }
  }, []);

  const setSelectedProject = useCallback((project: Project | null) => {
    setSelectedProjectState(project);
    if (project) {
      safeSetItem('selectedProjectId', project.id);
    } else {
      safeRemoveItem('selectedProjectId');
    }
  }, []);

  const value = React.useMemo(() => ({
    projects,
    selectedProject,
    loading,
    error,
    setSelectedProject,
    createProject,
    updateProject,
    deleteProject,
    refreshProjects,
    myPermissions,
    isOwner,
  }), [projects, selectedProject, loading, error, setSelectedProject, createProject, updateProject, deleteProject, refreshProjects, myPermissions, isOwner]);

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within ProjectProvider');
  }
  return context;
}
