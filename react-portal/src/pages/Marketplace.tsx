import React, { useState, useEffect } from 'react';
import { Navbar } from '../components/Navbar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api/client';
import { usePageView } from '../hooks/usePageView';

interface ForgeComponent {
  id: string;
  slug: string;
  name: string;
  component_type: string;
  description: string | null;
  icon: string | null;
  icon_color: string | null;
  version: string;
  install_command: string;
  badge: string | null;
  author: string | null;
  downloads: number;
  tags: string[];
  howto_guide: string | null;
  git_repo_url: string | null;
  git_ref: string | null;
}

const SIDEBAR_CATEGORIES = [
  { icon: 'smart_toy', label: 'Agents', key: 'agents', type: 'agent' },
  { icon: 'bolt', label: 'Skills', key: 'skills', type: 'skill' },
  { icon: 'dns', label: 'MCP Servers', key: 'mcp', type: 'mcp_server' },
  { icon: 'lightbulb', label: 'All', key: 'all', type: '' },
];

const BADGE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  verified: { label: 'Verified', color: 'text-green-500', bg: 'bg-green-500/10' },
  community: { label: 'Community', color: 'text-slate-500', bg: 'bg-slate-500/10' },
  open_source: { label: 'Open Source', color: 'text-primary', bg: 'bg-primary/10' },
};

const TYPE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  agent: { label: 'Agent', color: 'text-primary', bg: 'bg-primary/10' },
  skill: { label: 'Skill', color: 'text-amber-500', bg: 'bg-amber-500/10' },
  mcp_server: { label: 'MCP Server', color: 'text-purple-500', bg: 'bg-purple-500/10' },
};

interface ContributingGuide {
  video_slug: string | null;
  video_title: string | null;
  video_link: string | null;
}

export const Marketplace: React.FC = () => {
  usePageView('/marketplace');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeTab, setActiveTab] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [communityBuilt, setCommunityBuilt] = useState(false);
  const [openSource, setOpenSource] = useState(false);
  const [components, setComponents] = useState<ForgeComponent[]>([]);
  const [instructionsDialog, setInstructionsDialog] = useState<{ slug: string; name: string } | null>(null);
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [contributingGuide, setContributingGuide] = useState<ContributingGuide | null>(null);
  const [underConstruction, setUnderConstruction] = useState<{ under_construction: boolean; message: string } | null>(null);

  useEffect(() => {
    api.get<ForgeComponent[]>('/forge/components').then(setComponents).catch(() => {});
    api.get<ContributingGuide>('/forge/contributing-guide').then(setContributingGuide).catch(() => {});
    api.get<{ under_construction: boolean; message: string } | null>('/settings/marketplace_status')
      .then(setUnderConstruction)
      .catch(() => {});
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleCategoryClick = (key: string) => {
    setActiveCategory(key);
    const cat = SIDEBAR_CATEGORIES.find((c) => c.key === key);
    setActiveTab(cat?.type || '');
  };

  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard?.writeText(cmd).catch(() => {});
  };

  const handleInstall = (slug: string) => {
    api.post(`/forge/components/${slug}/install`).catch(() => {});
  };

  const handleDownload = async (slug: string) => {
    setDownloading((d) => ({ ...d, [slug]: true }));
    try {
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const token = localStorage.getItem('mst_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch(`${apiBase}/forge/components/${slug}/download`, { headers });
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('Download failed. Please try again.');
    } finally {
      setDownloading((d) => ({ ...d, [slug]: false }));
    }
  };

  const handleShowInstructions = async (slug: string, name: string) => {
    setInstructionsDialog({ slug, name });
    if (!instructions[slug]) {
      try {
        const res = await api.get<{ instructions: string }>(`/forge/components/${slug}/instructions`);
        setInstructions((prev) => ({ ...prev, [slug]: res.instructions }));
      } catch {
        setInstructions((prev) => ({ ...prev, [slug]: 'Failed to load instructions.' }));
      }
    }
  };

  const handleSort = () => {};
  const handleFooterLink = (_label: string) => {};

  const filteredCards = components.filter((c) => {
    const matchesSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()) || (c.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = !activeTab || c.component_type === activeTab;
    const matchesBadge =
      (!verifiedOnly && !communityBuilt && !openSource) ||
      (verifiedOnly && c.badge === 'verified') ||
      (communityBuilt && c.badge === 'community') ||
      (openSource && c.badge === 'open_source');
    return matchesSearch && matchesType && matchesBadge;
  });

  if (underConstruction?.under_construction) {
    return (
      <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen font-sans">
        <Navbar variant="solutions" />
        <main className="flex flex-col items-center justify-center min-h-screen px-6 pt-16 text-center">
          <div className="relative mb-8">
            <div className="absolute inset-0 w-32 h-32 bg-amber-400/20 rounded-full blur-2xl mx-auto" />
            <div className="relative w-32 h-32 mx-auto rounded-3xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-6xl text-amber-400">construction</span>
            </div>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
            Marketplace Under Construction
          </h1>
          <p className="text-base text-slate-500 dark:text-slate-400 max-w-md leading-relaxed mb-8">
            {underConstruction.message ||
              "We're upgrading the marketplace with new features. Check back soon — great things are coming!"}
          </p>
          <div className="flex items-center gap-4">
            <a
              href="/"
              className="px-6 py-2.5 bg-primary text-white font-bold rounded-lg text-sm hover:bg-blue-500 transition-colors"
            >
              Back to Solutions
            </a>
            <a
              href="/ignite"
              className="px-6 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700"
            >
              Explore Learning
            </a>
          </div>
          <div className="mt-12 flex items-center gap-2 text-xs text-slate-400">
            <span className="material-symbols-outlined text-amber-400 text-sm">info</span>
            Admins can manage this status from Admin Settings → Marketplace Status
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen font-sans">
      <Navbar variant="solutions" />

      <div className="relative flex flex-col min-h-screen w-full pt-16">
        <main className="flex-1 flex flex-col lg:flex-row">
          {/* Sidebar Filters */}
          <aside className="w-full lg:w-64 p-6 border-r border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-background-dark/50">
            <div className="space-y-8">
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Categories</h3>
                <div className="space-y-1">
                  {SIDEBAR_CATEGORIES.map((cat) => (
                    <button
                      key={cat.key}
                      onClick={() => handleCategoryClick(cat.key)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        activeCategory === cat.key
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[20px]">{cat.icon}</span>
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Interested in Contributing */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">volunteer_activism</span>
                  <h3 className="text-xs font-bold text-primary uppercase tracking-widest">Contribute</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
                  Interested in contributing an agent, skill, or MCP server to the marketplace?
                </p>
                {contributingGuide?.video_link ? (
                  <a
                    href={contributingGuide.video_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-blue-500 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">play_circle</span>
                    {contributingGuide.video_title ? `Watch: ${contributingGuide.video_title}` : 'Watch Guide'}
                  </a>
                ) : (
                  <a
                    href="/ignite"
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-blue-500 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                    Learn More
                  </a>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Verification</h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      checked={verifiedOnly}
                      onChange={(e) => setVerifiedOnly(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-700 text-primary focus:ring-primary bg-transparent"
                      type="checkbox"
                    />
                    <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200">
                      Verified by Intel
                    </span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      checked={communityBuilt}
                      onChange={(e) => setCommunityBuilt(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-700 text-primary focus:ring-primary bg-transparent"
                      type="checkbox"
                    />
                    <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200">
                      Community Built
                    </span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      checked={openSource}
                      onChange={(e) => setOpenSource(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-700 text-primary focus:ring-primary bg-transparent"
                      type="checkbox"
                    />
                    <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200">
                      Open Source
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Marketplace Content */}
          <div className="flex-1 min-w-0 overflow-hidden p-6 lg:p-10">
            {/* Heading row: title + search + view controls */}
            <div className="mb-8">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-1">
                <div>
                  <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Marketplace</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed">
                    Deploy pre-trained design agents, specialized skills, and model-context protocol servers
                    directly to your development environment.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {/* Search */}
                  <label className="relative block">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <span className="material-symbols-outlined text-[18px]">search</span>
                    </span>
                    <input
                      className="w-52 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg py-2 pl-9 pr-3 text-sm placeholder:text-slate-500 focus:ring-2 focus:ring-primary outline-none transition-all"
                      placeholder="Search registry..."
                      type="text"
                      value={searchQuery}
                      onChange={handleSearch}
                    />
                  </label>
                  {/* Card / List toggle */}
                  <div className="flex items-center bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5">
                    <button
                      onClick={() => setViewMode('card')}
                      className={`flex items-center justify-center p-1.5 rounded-md transition-colors ${viewMode === 'card' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                      title="Card view"
                    >
                      <span className="material-symbols-outlined text-[18px]">grid_view</span>
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`flex items-center justify-center p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                      title="List view"
                    >
                      <span className="material-symbols-outlined text-[18px]">view_list</span>
                    </button>
                  </div>
                  {/* Sort */}
                  <button
                    onClick={handleSort}
                    className="flex items-center gap-2 bg-slate-200 dark:bg-slate-800 px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    <span className="material-symbols-outlined text-[18px]">sort</span>
                    Popular
                  </button>
                </div>
              </div>
            </div>

            {/* Grid of Cards */}
            {viewMode === 'card' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredCards.map((card) => {
                const typeStyle = TYPE_BADGES[card.component_type] || TYPE_BADGES.agent;
                const badgeStyle = card.badge ? BADGE_STYLES[card.badge] : null;
                const displayBadge = badgeStyle || { label: typeStyle.label, color: typeStyle.color, bg: typeStyle.bg };
                return (
                  <div
                    key={card.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col hover:border-primary/50 transition-all group min-h-[240px]"
                  >
                    {/* Icon + title + badge */}
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className={`size-9 shrink-0 ${typeStyle.bg} rounded-lg flex items-center justify-center ${card.icon_color || typeStyle.color}`}>
                        <span className="material-symbols-outlined text-[20px]">{card.icon || 'smart_toy'}</span>
                      </div>
                      <h3 className="text-[15px] font-bold text-slate-900 dark:text-white leading-snug flex-1 truncate">{card.name}</h3>
                      <span className={`px-2 py-0.5 rounded ${displayBadge.bg} ${displayBadge.color} text-[10px] font-bold uppercase tracking-wider shrink-0`}>
                        {displayBadge.label}
                      </span>
                    </div>

                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 flex-grow leading-relaxed line-clamp-3">{card.description}</p>

                    <div className="bg-slate-100 dark:bg-slate-950 rounded-lg px-2.5 py-2 mb-3 font-mono text-[11px] flex items-center justify-between border border-slate-200 dark:border-slate-800">
                      <code className="text-primary/80 truncate">
                        {card.component_type === 'skill' ? `cp ${card.slug}/ .roo/skills/` : card.install_command}
                      </code>
                      <button
                        onClick={() => { handleCopyCommand(card.component_type === 'skill' ? `cp ${card.slug}/ .roo/skills/` : card.install_command); handleInstall(card.slug); }}
                        className="text-slate-500 hover:text-white transition-colors ml-2 shrink-0"
                      >
                        <span className="material-symbols-outlined text-[18px]">content_copy</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between mt-auto">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500 truncate max-w-[100px]">{card.author || 'MST Team'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500">{card.version} · {card.downloads}</span>
                        {card.git_repo_url && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(card.slug); }}
                            disabled={downloading[card.slug]}
                            className="p-1 rounded text-green-500 hover:text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-40"
                            title="Download as zip"
                          >
                            <span className={`material-symbols-outlined text-[16px] ${downloading[card.slug] ? 'animate-spin' : ''}`}>
                              {downloading[card.slug] ? 'progress_activity' : 'download'}
                            </span>
                          </button>
                        )}
                        {(card.component_type === 'skill' || card.component_type === 'mcp_server') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleShowInstructions(card.slug, card.name); }}
                            className="p-1 rounded text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                            title="Setup instructions"
                          >
                            <span className="material-symbols-outlined text-[16px]">integration_instructions</span>
                          </button>
                        )}
                        {card.howto_guide && (
                          <button
                            onClick={(e) => { e.stopPropagation(); window.open(`/marketplace/${card.slug}/howto`, '_blank'); }}
                            className="p-1 rounded text-primary hover:text-white hover:bg-primary/10 transition-colors"
                            title="How-To guide"
                          >
                            <span className="material-symbols-outlined text-[16px]">menu_book</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-200 dark:divide-slate-800">
              {filteredCards.map((card) => {
                const typeStyle = TYPE_BADGES[card.component_type] || TYPE_BADGES.agent;
                const badgeStyle = card.badge ? BADGE_STYLES[card.badge] : null;
                const displayBadge = badgeStyle || { label: typeStyle.label, color: typeStyle.color, bg: typeStyle.bg };
                return (
                  <div
                    key={card.id}
                    className="px-4 py-3 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group overflow-hidden"
                  >
                    <div className={`size-8 shrink-0 ${typeStyle.bg} rounded-lg flex items-center justify-center ${card.icon_color || typeStyle.color}`}>
                      <span className="material-symbols-outlined text-[18px]">{card.icon || 'smart_toy'}</span>
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{card.name}</h3>
                        <span className={`px-2 py-0.5 rounded ${displayBadge.bg} ${displayBadge.color} text-[9px] font-bold uppercase tracking-wider shrink-0`}>
                          {displayBadge.label}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-1 leading-relaxed">{card.description}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] text-slate-500 hidden sm:inline whitespace-nowrap">{card.author || 'MST Team'}</span>
                      <span className="text-[10px] text-slate-500 whitespace-nowrap">{card.version} · {card.downloads}</span>
                      {card.git_repo_url && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(card.slug); }}
                          disabled={downloading[card.slug]}
                          className="p-1 rounded text-green-500 hover:text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-40"
                          title="Download as zip"
                        >
                          <span className={`material-symbols-outlined text-[16px] ${downloading[card.slug] ? 'animate-spin' : ''}`}>
                            {downloading[card.slug] ? 'progress_activity' : 'download'}
                          </span>
                        </button>
                      )}
                      {(card.component_type === 'skill' || card.component_type === 'mcp_server') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleShowInstructions(card.slug, card.name); }}
                          className="p-1 rounded text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                          title="Setup instructions"
                        >
                          <span className="material-symbols-outlined text-[16px]">integration_instructions</span>
                        </button>
                      )}
                      {card.howto_guide && (
                        <button
                          onClick={(e) => { e.stopPropagation(); window.open(`/marketplace/${card.slug}/howto`, '_blank'); }}
                          className="p-1 rounded text-primary hover:text-white hover:bg-primary/10 transition-colors"
                          title="How-To guide"
                        >
                          <span className="material-symbols-outlined text-[16px]">menu_book</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            )}

            {filteredCards.length === 0 && (
              <div className="text-center py-20 text-slate-500">
                <span className="material-symbols-outlined text-4xl mb-4 block">search_off</span>
                <p>No results found for &ldquo;{searchQuery}&rdquo;</p>
              </div>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-green-500" />
              Global Registry Online
            </span>
            <span>v1.8.2-stable</span>
          </div>
          <div className="flex gap-6">
            <button onClick={() => handleFooterLink('Documentation')} className="hover:text-primary transition-colors">Documentation</button>
            <button onClick={() => handleFooterLink('Security Registry')} className="hover:text-primary transition-colors">Security Registry</button>
            <button onClick={() => handleFooterLink('Developer Portal')} className="hover:text-primary transition-colors">Developer Portal</button>
          </div>
        </footer>
      </div>

      {/* Setup Instructions Dialog */}
      {instructionsDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setInstructionsDialog(null)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[80vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Dialog header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-amber-500 text-[22px]">integration_instructions</span>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Setup Instructions</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{instructionsDialog.name}</p>
                </div>
              </div>
              <button
                onClick={() => setInstructionsDialog(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Dialog body — scrollable markdown */}
            <div className="overflow-y-auto px-6 py-5 flex-1">
              {instructions[instructionsDialog.slug] ? (
                <div className="prose prose-sm prose-slate dark:prose-invert max-w-none
                  prose-headings:font-bold prose-headings:text-slate-900 dark:prose-headings:text-white
                  prose-p:text-slate-600 dark:prose-p:text-slate-300
                  prose-li:text-slate-600 dark:prose-li:text-slate-300
                  prose-code:text-primary prose-code:bg-slate-100 dark:prose-code:bg-slate-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono
                  prose-pre:bg-slate-100 dark:prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-200 dark:prose-pre:border-slate-800 prose-pre:rounded-lg prose-pre:text-xs
                  prose-a:text-primary hover:prose-a:underline">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {instructions[instructionsDialog.slug]}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <span className="material-symbols-outlined text-2xl animate-spin mr-2">progress_activity</span>
                  Loading instructions…
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
