# Frontend Services Layer

Clean API abstraction layer for the eviStream frontend application.

## Quick Start

```typescript
import { projectsService, documentsService, formsService } from '@/services';

// Get all projects
const projects = await projectsService.getAll();

// Upload document with progress
await documentsService.upload({
  file: myFile,
  projectId: project.id,
  onUploadProgress: (progress) => console.log(progress)
});

// Create form and generate code
const form = await formsService.create(formData);
await formsService.generateCode(form.id);
```

## Available Services

| Service | Purpose | Key Methods |
|---------|---------|-------------|
| `authService` | Authentication | login, register, getCurrentUser, logout |
| `projectsService` | Projects CRUD | getAll, getById, create, update, delete |
| `documentsService` | Document management | getAll, upload, delete, downloadPDF |
| `formsService` | Forms & code generation | getAll, create, generateCode, getGenerationStatus |
| `extractionsService` | Extraction jobs | getAll, create, cancel, getStatus |
| `resultsService` | Results & exports | getAll, getById, exportCSV, exportJSON |
| `jobsService` | Job tracking | getAll, getStatus, cancel |
| `healthService` | Backend health | check, isBackendConnected |

## Architecture

```
Components/Pages → Services → APIClient → Backend API
```

**Never use `apiClient` directly in components** - always go through services.

## Benefits

- ✅ Clean separation of UI and API logic
- ✅ Full TypeScript type safety
- ✅ Reusable across components
- ✅ Easy to test and mock
- ✅ Centralized error handling
- ✅ Progress tracking for uploads

## Documentation

- **Migration Guide**: `SERVICES_MIGRATION_GUIDE.md`
- **Implementation Summary**: `SERVICES_LAYER_COMPLETE.md`

## Example Migration

**Before:**
```typescript
const data = await apiClient.get('/api/v1/documents?project_id=' + id);
await apiClient.delete('/api/v1/documents/' + docId);
```

**After:**
```typescript
const data = await documentsService.getAll(id);
await documentsService.delete(docId);
```

See `SERVICES_MIGRATION_GUIDE.md` for complete migration instructions.
