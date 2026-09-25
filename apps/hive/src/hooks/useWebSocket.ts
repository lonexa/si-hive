import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useDashboardStore } from '@/stores/dashboard-store';
import { API_BASE, WS_BASE } from '@/lib/api-config';
import { runUpdate } from '@/lib/run-update';
import type { WsMessage, DashboardState, Session, HookEvent, Team, TeamTask, SessionActivity, NotificationConfig, ProjectGroup, TaskQueue, QueueTask, ScheduledTask, LiveLoop, Schedule } from '@/stores/types';
const MAX_RECONNECT_DELAY = 30000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    setFullState,
    updateSessions,
    updateProjects,
    updateTeams,
    updateTasks,
    addEvent,
    updateEvents,
    setConnected,
    updateSessionActivities,
    updateNotificationConfig,
    updateAppConfig,
    addNotificationFired,
    updateQueues,
    updateScheduledTasks,
    updateLiveLoops,
    updateSchedules,
    updateProviders,
  } = useDashboardStore();

  useEffect(() => {
    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectDelayRef.current = 1000;

        // Fetch app config (not included in full_state)
        fetch(`${API_BASE}/api/config`)
          .then((res) => res.json())
          .then((data: { notifications?: NotificationConfig; projectsRoot?: string; theme?: 'dark' | 'light'; aiProviders?: any; providerStatus?: any }) => {
            if (data.notifications) updateNotificationConfig(data.notifications);
            updateAppConfig({
              projectsRoot: data.projectsRoot,
              theme: data.theme,
            });
            if (data.aiProviders && data.providerStatus) {
              updateProviders(data.aiProviders, data.providerStatus);
            }
          })
          .catch(() => {});
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          if (msg.version !== 1) return;

          const payload = msg.payload as Record<string, unknown>;

          switch (msg.type) {
            case 'full_state':
              setFullState(msg.payload as DashboardState);
              break;
            case 'sessions_updated':
              updateSessions(payload.sessions as Session[]);
              break;
            case 'projects_updated':
              updateProjects(payload.projects as ProjectGroup[]);
              break;
            case 'teams_updated':
              updateTeams(payload.teams as Team[]);
              break;
            case 'tasks_updated':
              updateTasks(
                payload.tasksByTeam as Record<string, TeamTask[]>,
                payload.tasksBySession as Record<string, TeamTask[]> | undefined
              );
              break;
            case 'event_added': {
              const events = payload.events as HookEvent[];
              if (events?.[0]) addEvent(events[0]);
              break;
            }
            case 'events_updated':
              updateEvents(payload.events as HookEvent[]);
              break;
            case 'session_activities_updated':
              updateSessionActivities(payload.sessionActivities as Record<string, SessionActivity>);
              break;
            case 'config_updated':
              updateAppConfig(payload as { notifications?: NotificationConfig; projectsRoot?: string; theme?: 'dark' | 'light' });
              if (payload.notifications) updateNotificationConfig(payload.notifications as NotificationConfig);
              if (payload.aiProviders && payload.providerStatus) {
                updateProviders(payload.aiProviders as any, payload.providerStatus as any);
              }
              break;
            case 'notification_fired':
              addNotificationFired(payload.sessionId as string);
              break;
            case 'queues_updated':
              updateQueues(payload.queues as Record<string, { queue: TaskQueue; tasks: QueueTask[] }>);
              break;
            case 'scheduled_tasks_updated':
              updateScheduledTasks(payload.scheduledTasks as ScheduledTask[]);
              break;
            case 'live_loops_updated':
              updateLiveLoops(payload.liveLoops as LiveLoop[]);
              break;
            case 'schedules_updated':
              updateSchedules(payload.schedules as Schedule[]);
              break;
            case 'force_update': {
              // An admin clicked "Force Update" on this user. Kick off the
              // standard update flow; runUpdate() handles the SSE stream
              // and reloads on success. Toast is non-dismissible so the
              // user knows what's happening.
              toast.info('Admin triggered an update', {
                description: 'Installing the latest version and restarting…',
                duration: 60_000,
              });
              void runUpdate((step, detail) => {
                if (step === 'building' || step === 'restarting' || step === 'done') {
                  toast.info(`Update: ${step}`, { description: detail });
                }
              });
              break;
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    function scheduleReconnect() {
      if (reconnectTimerRef.current) return;

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        reconnectDelayRef.current = Math.min(
          reconnectDelayRef.current * 2,
          MAX_RECONNECT_DELAY
        );
        connect();
      }, reconnectDelayRef.current);
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [setFullState, updateSessions, updateProjects, updateTeams, updateTasks, addEvent, updateEvents, setConnected, updateSessionActivities, updateNotificationConfig, updateAppConfig, addNotificationFired, updateQueues, updateScheduledTasks, updateLiveLoops, updateSchedules, updateProviders]);
}
