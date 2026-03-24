import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// ── Types ────────────────────────────────────────────────

interface Overview {
  total_views: number;
  unique_visitors: number;
  total_likes: number;
  total_downloads: number;
  total_users: number;
  published_videos: number;
  total_news: number;
  total_components: number;
}

interface TrafficDay {
  day: string;
  views: number;
  unique_visitors: number;
}

interface SectionTraffic {
  section: string;
  views: number;
  unique_visitors: number;
}

interface TopPage {
  path: string;
  views: number;
  unique_visitors: number;
}

interface Visitor {
  ip_address: string;
  visit_count: number;
  active_days: number;
  last_seen: string | null;
  first_seen: string | null;
  user_name: string | null;
  username: string | null;
}

interface VideoMetric {
  id: string;
  title: string;
  slug: string;
  category: string;
  duration_s: number | null;
  like_count: number;
  total_watched_hours: number;
  unique_viewers: number;
}

interface MarketplaceComponent {
  name: string;
  slug: string;
  component_type: string;
  downloads: number;
  recent_installs: number;
}

interface NewsArticle {
  id: string;
  title: string;
  badge: string | null;
  published_at: string | null;
  visit_count: number;
}

interface HeatmapCell {
  dow: number;
  hour: number;
  views: number;
}

// ── Constants ────────────────────────────────────────────

const SECTION_COLORS: Record<string, string> = {
  solutions: '#258cf4',
  marketplace: '#f59e0b',
  ignite: '#10b981',
  news: '#8b5cf6',
  other: '#64748b',
};

const PIE_COLORS = ['#258cf4', '#f59e0b', '#10b981', '#8b5cf6', '#64748b', '#ef4444'];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PERIOD_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

// ── Helpers ──────────────────────────────────────────────

const fmtNum = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
};

const fmtDate = (d: string) => {
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── Component ────────────────────────────────────────────

export const AdminAnalytics: React.FC = () => {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'overview' | 'traffic' | 'videos' | 'marketplace' | 'news'>('overview');

  const [overview, setOverview] = useState<Overview | null>(null);
  const [traffic, setTraffic] = useState<TrafficDay[]>([]);
  const [sectionTraffic, setSectionTraffic] = useState<SectionTraffic[]>([]);
  const [topPages, setTopPages] = useState<TopPage[]>([]);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [videoMetrics, setVideoMetrics] = useState<{ videos: VideoMetric[]; daily_likes: { day: string; likes: number }[]; chapter_navigations: { entity_name: string; navigations: number }[] } | null>(null);
  const [marketplaceMetrics, setMarketplaceMetrics] = useState<{ components: MarketplaceComponent[]; daily_installs: { day: string; installs: number }[] } | null>(null);
  const [newsMetrics, setNewsMetrics] = useState<{ articles: NewsArticle[]; daily_visits: { day: string; visits: number }[] } | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<Overview>(`/admin/analytics/overview?days=${days}`).then(setOverview).catch(() => {}),
      api.get<TrafficDay[]>(`/admin/analytics/traffic?days=${days}`).then(setTraffic).catch(() => {}),
      api.get<SectionTraffic[]>(`/admin/analytics/traffic/by-section?days=${days}`).then(setSectionTraffic).catch(() => {}),
      api.get<TopPage[]>(`/admin/analytics/traffic/top-pages?days=${days}`).then(setTopPages).catch(() => {}),
      api.get<Visitor[]>(`/admin/analytics/traffic/visitors?days=${days}`).then(setVisitors).catch(() => {}),
      api.get(`/admin/analytics/videos?days=${days}`).then((d: any) => setVideoMetrics(d)).catch(() => {}),
      api.get(`/admin/analytics/marketplace?days=${days}`).then((d: any) => setMarketplaceMetrics(d)).catch(() => {}),
      api.get(`/admin/analytics/news?days=${days}`).then((d: any) => setNewsMetrics(d)).catch(() => {}),
      api.get<HeatmapCell[]>(`/admin/analytics/hourly-heatmap?days=${Math.min(days, 90)}`).then(setHeatmap).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [days]);

  const chartTraffic = useMemo(() =>
    traffic.map(t => ({ ...t, day: fmtDate(t.day) })),
  [traffic]);

  const totalWatchHours = useMemo(() =>
    videoMetrics?.videos.reduce((sum, v) => sum + v.total_watched_hours, 0) ?? 0,
  [videoMetrics]);

  // Heatmap
  const heatmapMax = useMemo(() => Math.max(...heatmap.map(h => h.views), 1), [heatmap]);
  const heatmapGrid = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    heatmap.forEach(h => { grid[h.dow][h.hour] = h.views; });
    return grid;
  }, [heatmap]);

  const sections = [
    { key: 'overview', label: 'Overview', icon: 'dashboard' },
    { key: 'traffic', label: 'Traffic', icon: 'trending_up' },
    { key: 'videos', label: 'Videos', icon: 'videocam' },
    { key: 'marketplace', label: 'Marketplace', icon: 'storefront' },
    { key: 'news', label: 'News', icon: 'newspaper' },
  ] as const;

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-3xl">analytics</span>
            Analytics Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">Complete metrics across all portal sections</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-800/50 border border-white/10 rounded-lg p-1">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                days === opt.value
                  ? 'bg-primary text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Section Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-white/10">
        {sections.map(s => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all ${
              activeSection === s.key
                ? 'text-primary border-primary bg-primary/5'
                : 'text-slate-400 hover:text-white border-transparent'
            }`}
          >
            <span className="material-symbols-outlined text-base">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-slate-400 flex items-center gap-2">
            <span className="material-symbols-outlined animate-spin">progress_activity</span>
            Loading analytics...
          </div>
        </div>
      ) : (
        <>
          {/* ─── OVERVIEW ─── */}
          {activeSection === 'overview' && overview && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon="visibility" label="Total Views" value={fmtNum(overview.total_views)} color="text-primary" />
                <StatCard icon="people" label="Unique Visitors" value={fmtNum(overview.unique_visitors)} color="text-green-400" />
                <StatCard icon="favorite" label="Total Likes" value={fmtNum(overview.total_likes)} color="text-rose-400" />
                <StatCard icon="download" label="Total Downloads" value={fmtNum(overview.total_downloads)} color="text-amber-400" />
                <StatCard icon="person" label="Registered Users" value={fmtNum(overview.total_users)} color="text-purple-400" />
                <StatCard icon="videocam" label="Published Videos" value={fmtNum(overview.published_videos)} color="text-cyan-400" />
                <StatCard icon="newspaper" label="News Articles" value={fmtNum(overview.total_news)} color="text-orange-400" />
                <StatCard icon="extension" label="Components" value={fmtNum(overview.total_components)} color="text-indigo-400" />
              </div>

              {/* Traffic Chart */}
              <ChartCard title="Traffic Over Time" icon="trending_up">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartTraffic}>
                    <defs>
                      <linearGradient id="gradViews" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#258cf4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#258cf4" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradVisitors" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                    <Legend />
                    <Area type="monotone" dataKey="views" stroke="#258cf4" fill="url(#gradViews)" strokeWidth={2} name="Page Views" />
                    <Area type="monotone" dataKey="unique_visitors" stroke="#10b981" fill="url(#gradVisitors)" strokeWidth={2} name="Unique Visitors" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Section Breakdown + Heatmap */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartCard title="Views by Section" icon="category">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={sectionTraffic.map(s => ({ name: s.section, value: s.views }))}
                        cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                        dataKey="value" paddingAngle={3}
                      >
                        {sectionTraffic.map((s, i) => (
                          <Cell key={s.section} fill={SECTION_COLORS[s.section] || PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                      <Legend formatter={(v: string) => <span className="text-xs text-slate-300 capitalize">{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Activity Heatmap" icon="grid_on" subtitle="Day of Week × Hour of Day">
                  <div className="overflow-x-auto">
                    <div className="min-w-[500px]">
                      {/* Hour labels */}
                      <div className="flex ml-10 mb-1">
                        {Array.from({ length: 24 }, (_, h) => (
                          <div key={h} className="flex-1 text-center text-[9px] text-slate-500">
                            {h % 4 === 0 ? `${h}h` : ''}
                          </div>
                        ))}
                      </div>
                      {heatmapGrid.map((row, dow) => (
                        <div key={dow} className="flex items-center gap-1 mb-0.5">
                          <span className="text-[10px] text-slate-500 w-8 text-right">{DAY_NAMES[dow]}</span>
                          <div className="flex flex-1 gap-0.5">
                            {row.map((val, hour) => {
                              const intensity = heatmapMax > 0 ? val / heatmapMax : 0;
                              return (
                                <div
                                  key={hour}
                                  className="flex-1 h-4 rounded-sm transition-colors"
                                  style={{
                                    backgroundColor: intensity === 0
                                      ? 'rgba(30, 41, 59, 0.5)'
                                      : `rgba(37, 140, 244, ${0.15 + intensity * 0.85})`,
                                  }}
                                  title={`${DAY_NAMES[dow]} ${hour}:00 — ${val} views`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </ChartCard>
              </div>
            </div>
          )}

          {/* ─── TRAFFIC ─── */}
          {activeSection === 'traffic' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Pages */}
                <ChartCard title="Top Pages" icon="web">
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                    {topPages.map((p, i) => (
                      <div key={p.path} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-800/30 border border-white/5">
                        <span className="text-xs font-bold text-slate-500 w-5 text-right">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate font-mono">{p.path}</p>
                          <p className="text-[10px] text-slate-500">{p.unique_visitors} unique visitors</p>
                        </div>
                        <span className="text-sm font-bold text-primary">{fmtNum(p.views)}</span>
                      </div>
                    ))}
                    {topPages.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No data yet</p>}
                  </div>
                </ChartCard>

                {/* Visitors */}
                <ChartCard title="Top Visitors" icon="person_search">
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                    {visitors.map((v, i) => (
                      <div key={v.ip_address || i} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-800/30 border border-white/5">
                        <span className="text-xs font-bold text-slate-500 w-5 text-right">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-white font-mono">{v.ip_address || 'Unknown'}</p>
                            {v.user_name && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">{v.user_name}</span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500">
                            Active {v.active_days} day(s) · Last: {v.last_seen ? new Date(v.last_seen).toLocaleDateString() : '—'}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-green-400">{fmtNum(v.visit_count)}</span>
                      </div>
                    ))}
                    {visitors.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No data yet</p>}
                  </div>
                </ChartCard>
              </div>

              {/* Section breakdown bar chart */}
              <ChartCard title="Views by Section" icon="bar_chart">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={sectionTraffic}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="section" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="views" name="Views" radius={[4, 4, 0, 0]}>
                      {sectionTraffic.map((s, i) => (
                        <Cell key={s.section} fill={SECTION_COLORS[s.section] || PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Bar>
                    <Bar dataKey="unique_visitors" name="Unique Visitors" fill="#10b981" radius={[4, 4, 0, 0]} opacity={0.6} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}

          {/* ─── VIDEOS ─── */}
          {activeSection === 'videos' && videoMetrics && (
            <div className="space-y-6">
              {/* Video summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon="favorite" label="Total Likes" value={fmtNum(videoMetrics.videos.reduce((s, v) => s + v.like_count, 0))} color="text-rose-400" />
                <StatCard icon="schedule" label="Watch Hours" value={totalWatchHours.toFixed(1) + 'h'} color="text-cyan-400" />
                <StatCard icon="people" label="Unique Viewers" value={fmtNum(videoMetrics.videos.reduce((s, v) => s + v.unique_viewers, 0))} color="text-green-400" />
                <StatCard icon="touch_app" label="Chapter Navs" value={fmtNum(videoMetrics.chapter_navigations.reduce((s, c) => s + c.navigations, 0))} color="text-amber-400" />
              </div>

              {/* Daily likes chart */}
              <ChartCard title="Daily Likes" icon="favorite">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={videoMetrics.daily_likes.map(d => ({ ...d, day: fmtDate(d.day) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="likes" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Video table */}
              <ChartCard title="Video Performance" icon="videocam">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400">
                        <th className="text-left py-2 px-3 font-medium">Video</th>
                        <th className="text-left py-2 px-3 font-medium">Category</th>
                        <th className="text-right py-2 px-3 font-medium">Likes</th>
                        <th className="text-right py-2 px-3 font-medium">Watch Hrs</th>
                        <th className="text-right py-2 px-3 font-medium">Viewers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {videoMetrics.videos.map(v => (
                        <tr key={v.id} className="border-b border-white/5 hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5 px-3 text-white font-medium">{v.title}</td>
                          <td className="py-2.5 px-3">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium uppercase">{v.category}</span>
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-400 font-bold">{v.like_count}</td>
                          <td className="py-2.5 px-3 text-right text-cyan-400 font-mono">{v.total_watched_hours}</td>
                          <td className="py-2.5 px-3 text-right text-green-400">{v.unique_viewers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {videoMetrics.videos.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No videos yet</p>}
                </div>
              </ChartCard>

              {/* Chapter navigations */}
              {videoMetrics.chapter_navigations.length > 0 && (
                <ChartCard title="Most Navigated Chapters" icon="bookmark">
                  <ResponsiveContainer width="100%" height={Math.max(200, videoMetrics.chapter_navigations.length * 35)}>
                    <BarChart data={videoMetrics.chapter_navigations} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis type="number" stroke="#64748b" fontSize={11} />
                      <YAxis type="category" dataKey="entity_name" stroke="#64748b" fontSize={10} width={150} />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="navigations" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
            </div>
          )}

          {/* ─── MARKETPLACE ─── */}
          {activeSection === 'marketplace' && marketplaceMetrics && (
            <div className="space-y-6">
              <StatCard icon="download" label="Total Downloads" value={fmtNum(marketplaceMetrics.components.reduce((s, c) => s + c.downloads, 0))} color="text-amber-400" />

              {/* Daily installs chart */}
              <ChartCard title="Daily Installs" icon="install_desktop">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={marketplaceMetrics.daily_installs.map(d => ({ ...d, day: fmtDate(d.day) }))}>
                    <defs>
                      <linearGradient id="gradInstalls" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey="installs" stroke="#f59e0b" fill="url(#gradInstalls)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Component table */}
              <ChartCard title="Component Downloads" icon="extension">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400">
                        <th className="text-left py-2 px-3 font-medium">Component</th>
                        <th className="text-left py-2 px-3 font-medium">Type</th>
                        <th className="text-right py-2 px-3 font-medium">All-time</th>
                        <th className="text-right py-2 px-3 font-medium">Recent ({days}d)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketplaceMetrics.components.map(c => (
                        <tr key={c.slug} className="border-b border-white/5 hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5 px-3 text-white font-medium">{c.name}</td>
                          <td className="py-2.5 px-3">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium uppercase">{c.component_type}</span>
                          </td>
                          <td className="py-2.5 px-3 text-right text-amber-400 font-bold">{c.downloads}</td>
                          <td className="py-2.5 px-3 text-right text-green-400">{c.recent_installs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {marketplaceMetrics.components.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No components yet</p>}
                </div>
              </ChartCard>
            </div>
          )}

          {/* ─── NEWS ─── */}
          {activeSection === 'news' && newsMetrics && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard icon="newspaper" label="Total Articles" value={fmtNum(newsMetrics.articles.length)} color="text-purple-400" />
                <StatCard icon="visibility" label="Total Visits" value={fmtNum(newsMetrics.articles.reduce((s, a) => s + a.visit_count, 0))} color="text-primary" />
                <StatCard icon="star" label="Most Visited" value={newsMetrics.articles[0]?.title.slice(0, 20) || '—'} color="text-amber-400" small />
              </div>

              {/* Daily news visits chart */}
              <ChartCard title="Daily News Visits" icon="trending_up">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={newsMetrics.daily_visits.map(d => ({ ...d, day: fmtDate(d.day) }))}>
                    <defs>
                      <linearGradient id="gradNewsVisits" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey="visits" stroke="#8b5cf6" fill="url(#gradNewsVisits)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* News article table */}
              <ChartCard title="Article Performance" icon="article">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400">
                        <th className="text-left py-2 px-3 font-medium">Article</th>
                        <th className="text-left py-2 px-3 font-medium">Badge</th>
                        <th className="text-left py-2 px-3 font-medium">Published</th>
                        <th className="text-right py-2 px-3 font-medium">Visits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newsMetrics.articles.map(a => (
                        <tr key={a.id} className="border-b border-white/5 hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5 px-3 text-white font-medium max-w-[300px] truncate">{a.title}</td>
                          <td className="py-2.5 px-3">
                            {a.badge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 font-medium">{a.badge}</span>}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-xs">
                            {a.published_at ? new Date(a.published_at).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-purple-400 font-bold">{a.visit_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {newsMetrics.articles.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No articles yet</p>}
                </div>
              </ChartCard>
            </div>
          )}
        </>
      )}
    </div>
  );
};


// ── Sub-components ───────────────────────────────────────

const StatCard: React.FC<{ icon: string; label: string; value: string; color: string; small?: boolean }> = ({ icon, label, value, color, small }) => (
  <div className="bg-card-dark border border-white/5 rounded-xl p-4 flex items-center gap-4 hover:border-white/10 transition-colors">
    <div className={`w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center ${color}`}>
      <span className="material-symbols-outlined text-xl">{icon}</span>
    </div>
    <div className="min-w-0">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{label}</p>
      <p className={`font-bold text-white ${small ? 'text-sm truncate' : 'text-xl'}`}>{value}</p>
    </div>
  </div>
);

const ChartCard: React.FC<{ title: string; icon: string; subtitle?: string; children: React.ReactNode }> = ({ title, icon, subtitle, children }) => (
  <div className="bg-card-dark border border-white/5 rounded-xl overflow-hidden">
    <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
      <span className="material-symbols-outlined text-primary text-lg">{icon}</span>
      <div>
        <h3 className="text-sm font-bold text-white">{title}</h3>
        {subtitle && <p className="text-[10px] text-slate-500">{subtitle}</p>}
      </div>
    </div>
    <div className="p-5">
      {children}
    </div>
  </div>
);
