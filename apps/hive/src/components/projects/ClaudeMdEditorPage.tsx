import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ClaudeMdEditor from './ClaudeMdEditor';

export default function ClaudeMdEditorPage() {
  const { projectPath } = useParams<{ projectPath: string }>();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-3 mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/projects')}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          data-track="claude_md_editor.back_to_projects"
          data-track-category="nav"
        >
          <ArrowLeft className="h-4 w-4" />
          Projects
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm text-muted-foreground font-mono truncate">
          {projectPath ? decodeURIComponent(projectPath) : 'Global'}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ClaudeMdEditor encodedPath={projectPath} mode={projectPath ? 'project' : 'global'} />
      </div>
    </div>
  );
}
