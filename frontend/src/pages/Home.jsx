import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { Sparkles, Activity, FileText, Clock, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';

function StatCard({ icon: Icon, value, label, badge }) {
  return (
    <div className="border border-[#ecece9] rounded-xl p-5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.05)] cursor-pointer transition-all duration-150 flex flex-col justify-between h-[116px] bg-white group">
      <div className="flex items-center justify-between">
        <div className="w-8 h-8 rounded-lg border border-[#ecece9] flex items-center justify-center bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <Icon className="w-4 h-4 text-gray-700" />
        </div>
        {badge && (
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 tracking-tight leading-none mb-1 animate-count-up">{value}</p>
        <p className="text-[12px] font-medium text-gray-500">{label}</p>
      </div>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Home() {
  const user     = useSelector((s) => s.auth.user);
  const sessions = useSelector((s) => s.session.sessions);
  const pipeline = useSelector((s) => s.pipeline);

  const firstName = user?.name?.split(' ')[0] || 'there';

  const stats = useMemo(() => {
    const total    = sessions.length;
    const complete = sessions.filter((s) => {
      const pid = s._id || s.mediaId;
      const ps  = pipeline[pid]?.status || s.status;
      return ps === 'completed';
    }).length;
    const failed   = sessions.filter((s) => {
      const pid = s._id || s.mediaId;
      const ps  = pipeline[pid]?.status || s.status;
      return ps === 'failed';
    });
    const recentWeek = sessions.filter((s) => {
      if (!s.createdAt) return false;
      const diff = (Date.now() - new Date(s.createdAt)) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    }).length;

    return { total, complete, failed, recentWeek };
  }, [sessions, pipeline]);

  const suggestedActions = useMemo(() => {
    const items = [];
    stats.failed.slice(0, 2).forEach((s) => {
      items.push({
        id: s._id || s.mediaId,
        color: 'bg-red-400',
        title: `Retry failed session`,
        subtitle: s.title || s.originalFilename || 'Untitled',
        icon: XCircle,
      });
    });
    const recent = sessions
      .filter((s) => {
        const pid = s._id || s.mediaId;
        const ps  = pipeline[pid]?.status || s.status;
        return ps === 'completed';
      })
      .slice(0, 2 - items.length);
    recent.forEach((s) => {
      items.push({
        id: s._id || s.mediaId,
        color: 'bg-emerald-400',
        title: 'Review session summary',
        subtitle: s.title || s.originalFilename || 'Untitled',
        icon: CheckCircle2,
      });
    });

    if (items.length === 0) {
      items.push(
        { id: 'demo-1', color: 'bg-red-400',  title: 'Review Q3 Planning action items', subtitle: '2 pending items due this week' },
        { id: 'demo-2', color: 'bg-gray-300',  title: 'Prepare for Client Kickoff', subtitle: 'Review notes from initial intro' },
      );
    }
    return items;
  }, [sessions, pipeline, stats]);

  return (
    <div className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">

      {/* Top Header */}
      <div className="h-14 border-b border-[#ecece9] flex items-center justify-between px-6 shrink-0 bg-white z-10 w-full">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-400" />
          <h2 className="text-[14px] font-medium text-gray-800">Overview</h2>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-10">
        <div className="max-w-3xl mx-auto space-y-10 pb-16">

          {/* Greeting */}
          <div>
            <h1 className="text-3xl font-bold text-[#37352f] tracking-tight">
              {getGreeting()}, {firstName} 👋
            </h1>
            <p className="text-[14px] text-gray-400 mt-1">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              icon={Activity}
              value={stats.total}
              label="Total Sessions"
              badge={stats.recentWeek > 0 ? `+${stats.recentWeek} this week` : undefined}
            />
            <StatCard
              icon={FileText}
              value={stats.complete}
              label="Analyzed Sessions"
            />
            <StatCard
              icon={Clock}
              value={stats.failed.length > 0 ? stats.failed.length : '–'}
              label={stats.failed.length > 0 ? 'Needs Attention' : 'Pending Issues'}
            />
          </div>

          {/* Suggested Actions */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-gray-700" />
              <h2 className="text-[14px] font-semibold text-gray-900">Suggested Actions</h2>
            </div>
            <div className="flex flex-col gap-2">
              {suggestedActions.map((action) => (
                <div
                  key={action.id}
                  className="group flex items-center justify-between border border-[#ecece9] rounded-xl p-4 cursor-pointer hover:bg-gray-50/60 hover:border-gray-300 transition-all duration-150 bg-white"
                >
                  <div className="flex flex-col">
                    <h4 className="text-[13px] font-semibold text-gray-900 mb-0.5 flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${action.color} shrink-0`} />
                      {action.title}
                    </h4>
                    <p className="text-[12px] text-gray-500 pl-4">{action.subtitle}</p>
                  </div>
                  <button className="text-gray-300 group-hover:text-gray-700 p-2 rounded-lg border border-transparent group-hover:bg-white group-hover:border-[#ecece9] group-hover:shadow-sm transition-all">
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
