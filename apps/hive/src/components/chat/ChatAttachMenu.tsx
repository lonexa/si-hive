import { useState, useEffect } from 'react';
import { Plus, Search, Wand2, Bot, Puzzle, ChevronDown, ChevronRight, Users } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useChatStore } from '@/stores/chat-store';
import { API_BASE } from '@/lib/api-config';

interface SkillInfo { name: string; description: string; triggers: string[] }
interface AgentInfo { filename: string; name: string; description: string }
interface PluginInfo { id: string; name: string; description: string }
interface TeamItem { id: number; name: string; description: string; item_type: string; tags: string; created_by: string }

export default function ChatAttachMenu() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [teamSkills, setTeamSkills] = useState<TeamItem[]>([]);
  const [teamAgents, setTeamAgents] = useState<TeamItem[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { addActiveSkill, addActiveAgent } = useChatStore();

  useEffect(() => {
    if (!open) return;
    // Fetch all sources in parallel
    Promise.all([
      fetch(`${API_BASE}/api/skills`).then((r) => r.json()).catch(() => []),
      fetch(`${API_BASE}/api/agents`).then((r) => r.json()).catch(() => []),
      fetch(`${API_BASE}/api/plugins`).then((r) => r.json()).catch(() => ({ plugins: [] })),
      fetch(`${API_BASE}/api/sharing/items?type=skill`).then((r) => r.json()).catch(() => []),
      fetch(`${API_BASE}/api/sharing/items?type=agent`).then((r) => r.json()).catch(() => []),
    ]).then(([skillsData, agentsData, pluginsData, teamSkillsData, teamAgentsData]) => {
      // Skills & agents APIs return bare arrays
      setSkills(Array.isArray(skillsData) ? skillsData : []);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
      // Plugins API returns { plugins: [] }
      const pList = (pluginsData as { plugins?: PluginInfo[] }).plugins;
      setPlugins(Array.isArray(pList) ? pList : []);
      // Team items return arrays
      setTeamSkills(Array.isArray(teamSkillsData) ? teamSkillsData : []);
      setTeamAgents(Array.isArray(teamAgentsData) ? teamAgentsData : []);
    });
  }, [open]);

  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const q = search.toLowerCase();
  const filteredSkills = skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  const filteredAgents = agents.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
  const filteredPlugins = plugins.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  const filteredTeamSkills = teamSkills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  const filteredTeamAgents = teamAgents.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));

  const totalResults = filteredSkills.length + filteredAgents.length + filteredPlugins.length + filteredTeamSkills.length + filteredTeamAgents.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-track="chat.attach_menu_open"
          data-track-category="modal"
          className="shrink-0 h-10 w-10 rounded-xl bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors flex items-center justify-center"
          title="Attach skills, agents, or plugins"
        >
          <Plus className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-45' : ''}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-[380px] p-0 overflow-hidden flex flex-col" style={{ maxHeight: '420px' }}>
        {/* Search */}
        <div className="p-2 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills, agents, plugins..."
              className="w-full bg-secondary text-sm rounded-md px-3 py-1.5 pl-8 border border-border text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
          </div>
        </div>

        {/* Scrollable content - use native overflow instead of ScrollArea for reliability */}
        <div className="flex-1 overflow-y-auto overscroll-contain" style={{ maxHeight: '360px' }}>
          <div className="p-1">
            {totalResults === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {skills.length === 0 && agents.length === 0 && teamSkills.length === 0
                  ? 'No skills, agents, or plugins found. Check that you have skills installed in ~/.claude/skills/'
                  : 'No results match your search'}
              </div>
            )}

            {/* Team Skills */}
            <CollapsibleSection
              id="team-skills"
              label="Team Skills"
              icon={<Users className="h-3 w-3" />}
              count={filteredTeamSkills.length}
              collapsed={collapsed.has('team-skills')}
              onToggle={() => toggleSection('team-skills')}
              headerColor="text-purple-400"
            >
              {filteredTeamSkills.map((skill) => (
                <ItemRow
                  key={`team-skill-${skill.id}`}
                  track="chat.attach_team_skill"
                  icon={<Wand2 className="h-4 w-4 text-purple-400" />}
                  name={skill.name}
                  description={skill.description}
                  meta={skill.created_by}
                  onClick={() => { addActiveSkill(skill.name); setOpen(false); }}
                />
              ))}
            </CollapsibleSection>

            {/* Team Agents */}
            <CollapsibleSection
              id="team-agents"
              label="Team Agents"
              icon={<Users className="h-3 w-3" />}
              count={filteredTeamAgents.length}
              collapsed={collapsed.has('team-agents')}
              onToggle={() => toggleSection('team-agents')}
              headerColor="text-purple-400"
            >
              {filteredTeamAgents.map((agent) => (
                <ItemRow
                  key={`team-agent-${agent.id}`}
                  track="chat.attach_team_agent"
                  icon={<Bot className="h-4 w-4 text-purple-400" />}
                  name={agent.name}
                  description={agent.description}
                  meta={agent.created_by}
                  onClick={() => { addActiveAgent(agent.name); setOpen(false); }}
                />
              ))}
            </CollapsibleSection>

            {/* Local Skills */}
            <CollapsibleSection
              id="skills"
              label="My Skills"
              icon={<Wand2 className="h-3 w-3" />}
              count={filteredSkills.length}
              collapsed={collapsed.has('skills')}
              onToggle={() => toggleSection('skills')}
              headerColor="text-primary"
            >
              {filteredSkills.map((skill) => (
                <ItemRow
                  key={`skill-${skill.name}`}
                  track="chat.attach_skill"
                  icon={<Wand2 className="h-4 w-4 text-primary" />}
                  name={skill.name}
                  description={skill.description}
                  onClick={() => { addActiveSkill(skill.name); setOpen(false); }}
                />
              ))}
            </CollapsibleSection>

            {/* Local Agents */}
            <CollapsibleSection
              id="agents"
              label="My Agents"
              icon={<Bot className="h-3 w-3" />}
              count={filteredAgents.length}
              collapsed={collapsed.has('agents')}
              onToggle={() => toggleSection('agents')}
              headerColor="text-green-500"
            >
              {filteredAgents.map((agent) => (
                <ItemRow
                  key={`agent-${agent.filename}`}
                  track="chat.attach_agent"
                  icon={<Bot className="h-4 w-4 text-green-500" />}
                  name={agent.name}
                  description={agent.description}
                  onClick={() => { addActiveAgent(agent.name); setOpen(false); }}
                />
              ))}
            </CollapsibleSection>

            {/* Plugins */}
            <CollapsibleSection
              id="plugins"
              label="Plugins"
              icon={<Puzzle className="h-3 w-3" />}
              count={filteredPlugins.length}
              collapsed={collapsed.has('plugins')}
              onToggle={() => toggleSection('plugins')}
              headerColor="text-violet-400"
            >
              {filteredPlugins.map((plugin) => (
                <ItemRow
                  key={`plugin-${plugin.id}`}
                  track="chat.attach_plugin"
                  icon={<Puzzle className="h-4 w-4 text-violet-400" />}
                  name={plugin.name}
                  description={plugin.description}
                  onClick={() => { addActiveSkill(`plugin:${plugin.name}`); setOpen(false); }}
                />
              ))}
            </CollapsibleSection>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CollapsibleSection({ label, icon, count, collapsed, onToggle, headerColor, children }: {
  id: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  headerColor: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${headerColor} hover:opacity-80 transition-opacity`}
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {icon}
        <span>{label}</span>
        <span className="ml-auto text-[9px] opacity-70">{count}</span>
      </button>
      {!collapsed && children}
    </div>
  );
}

function ItemRow({ icon, name, description, meta, onClick, track }: {
  icon: React.ReactNode;
  name: string;
  description: string;
  meta?: string;
  onClick: () => void;
  track?: string;
}) {
  return (
    <button
      data-track={track}
      data-track-category="action"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none text-muted-foreground rounded-sm"
    >
      <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground truncate">{name}</div>
        <div className="text-[11px] text-muted-foreground truncate">{description || 'No description'}</div>
        {meta && <div className="text-[10px] text-muted-foreground/60 truncate">by {meta}</div>}
      </div>
    </button>
  );
}
