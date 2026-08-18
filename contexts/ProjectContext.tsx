'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { projectsService } from '@/services';
import { projectMembersService } from '@/services/project-members.service';
import { Project as APIProject, CreateProjectRequest, MyPermissionsResponse } from '@/types/api';
import { getErrorMessage } from '@/lib/utils';
import { apiClient } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// Re-export Project type from API
export type Project = APIProject;

interface ProjectContextType {
  /** Active projects only. Every existing consumer reads this, so archived
   *  projects disappear from the selector and all dropdowns automatically. */
  projects: Project[];
  /** Active + archived. Use this when looking a project up by id (e.g. a
   *  project detail page), so archived projects still resolve. */
  allProjects: Project[];
  archivedProjects: Project[];
  selectedProject: Project | null;
  loading: boolean;
  error: string | null;
  setSelectedProject: (project: Project | null) => void;
  createProject: (name: string, description?: string) => Promise<Project>;
  updateProject: (id: string, updates: Partial<CreateProjectRequest>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  unarchiveProject: (id: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  myPermissions: MyPermissionsResponse | null;
  isOwner: boolean;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const isArchived = (p: Project) => !!p.archived_at;

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

// Only ever select an ACTIVE project — otherwise a project archived in a
// previous session could be restored into the selector from the cache.
function getInitialSelectedProject(projects: Project[]): Project | null {
  const active = projects.filter((p) => !isArchived(p));
  const storedId = safeGetItem('selectedProjectId');
  if (storedId && active.length > 0) {
    const found = active.find((p) => p.id === storedId);
    if (found) return found;
  }
  return active.length > 0 ? active[0] : null;
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
  // Holds active AND archived; the exposed `projects` is the active subset.
  const [allProjects, setAllProjects] = useState<Project[]>(initialProjects);
  const [selectedProject, setSelectedProjectState] = useState<Project | null>(initialSelected);
  const [loading, setLoading] = useState(!initialSelected);
  const [error, setError] = useState<string | null>(null);
  const [myPermissions, setMyPermissions] = useState<MyPermissionsResponse | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const refreshInFlight = useRef(false);

  // Sort defensively rather than trusting arrival order: the localStorage cache
  // can hold an older ordering, and optimistic updates drift (createProject
  // prepends, archive/update map in place). .filter() already copies, so the
  // in-place .sort() never mutates allProjects.
  const byNewest = (a: string | null | undefined, b: string | null | undefined) =>
    new Date(b || 0).getTime() - new Date(a || 0).getTime();

  const projects = useMemo(
    () => allProjects.filter((p) => !isArchived(p))
      .sort((a, b) => byNewest(a.created_at, b.created_at)),
    [allProjects]
  );
  // Archived list is ordered most-recently-archived first — more useful than
  // creation order when you're looking for something you just archived.
  const archivedProjects = useMemo(
    () => allProjects.filter(isArchived)
      .sort((a, b) => byNewest(a.archived_at, b.archived_at)),
    [allProjects]
  );

  const refreshProjects = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    // Only show loading if we have no cached projects (avoids flash on background refresh)
    if (!safeGetItem('projects')) setLoading(true);
    setError(null);
    try {
      // Fetch archived too, then filter locally — the Projects page needs the
      // archived list, and everything else reads the filtered `projects`.
      const data = await projectsService.getAll(true);
      setAllProjects(data);
      safeSetItem('projects', JSON.stringify(data));
    } catch (err: unknown) {
      console.error('Failed to fetch projects:', err);
      setError('Failed to load projects');

      // Fallback to localStorage
      const stored = safeGetItem('projects');
      if (stored) {
        try {
          setAllProjects(JSON.parse(stored));
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

  // Restore selected project from localStorage. Depends on the ACTIVE list, so
  // an archived project can never be auto-selected.
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
          can_run_manual_extractions: false,
          can_view_results: true,
          can_adjudicate: false,
          can_qa_review: false,
          can_manage_assignments: false,
          can_manage_members: false,
          can_manage_project: false,
        };
        setMyPermissions(fallback);
        setIsOwner(false);
      });
  }, [selectedProject]);

  const createProject = useCallback(async (name: string, description?: string): Promise<Project> => {
    const request: CreateProjectRequest = { name, description };

    try {
      const newProject = await projectsService.create(request);
      setAllProjects((prev) => {
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

      setAllProjects((prev) => {
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

      setAllProjects((prev) => {
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

  // Archive/restore keep the row in `allProjects` (so its detail page still
  // resolves) and let the `projects` memo move it in or out of the active list.
  const setArchived = useCallback(async (id: string, archived: boolean): Promise<void> => {
    try {
      const updated = archived
        ? await projectsService.archive(id)
        : await projectsService.unarchive(id);

      setAllProjects((prev) => {
        const next = prev.map((p) => (p.id === id ? updated : p));
        safeSetItem('projects', JSON.stringify(next));
        return next;
      });

      if (archived) {
        // Archived projects are hidden, so drop the selection if it was this
        // one; the effect on `projects` picks the next active project.
        setSelectedProjectState((prev) => {
          if (prev?.id === id) {
            safeRemoveItem('selectedProjectId');
            return null;
          }
          return prev;
        });
      }
    } catch (err: unknown) {
      console.error(`Failed to ${archived ? 'archive' : 'restore'} project:`, err);
      throw new Error(getErrorMessage(err, `Failed to ${archived ? 'archive' : 'restore'} project`));
    }
  }, []);

  const archiveProject = useCallback((id: string) => setArchived(id, true), [setArchived]);
  const unarchiveProject = useCallback((id: string) => setArchived(id, false), [setArchived]);

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
    allProjects,
    archivedProjects,
    selectedProject,
    loading,
    error,
    setSelectedProject,
    createProject,
    updateProject,
    deleteProject,
    archiveProject,
    unarchiveProject,
    refreshProjects,
    myPermissions,
    isOwner,
  }), [projects, allProjects, archivedProjects, selectedProject, loading, error, setSelectedProject, createProject, updateProject, deleteProject, archiveProject, unarchiveProject, refreshProjects, myPermissions, isOwner]);

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
