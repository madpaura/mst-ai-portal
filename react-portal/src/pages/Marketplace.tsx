import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
  const [instructionsSlug, setInstructionsSlug] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [contributingGuide, setContributingGuide] = useState<ContributingGuide | null>(null);

  useEffect(() => {
    api.get<ForgeComponent[]>('/forge/components').then(setComponents).catch(() => {});
    api.get<ContributingGuide>('/forge/contributing-guide').then(setContributingGuide).catch(() => {});
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

  const handleShowInstructions = async (slug: string) => {
    if (instructionsSlug === slug) {
      setInstructionsSlug(null);
      return;
    }
    setInstructionsSlug(slug);
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
  const handleProfileClick = () => {};
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

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen font-sans">
      <div className="relative flex flex-col min-h-screen w-full">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 lg:px-12 py-4 bg-background-light dark:bg-background-dark sticky top-0 z-50 font-sans">
          <div className="flex items-center gap-8">
            <Link to="/marketplace" className="flex items-center gap-3">
              <div className="size-8 bg-primary rounded-lg flex items-center justify-center text-white">
                <span className="material-symbols-outlined">memory</span>
              </div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white uppercase tracking-widest">
                Marketplace
              </h2>
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              <Link
                to="/"
                className="text-slate-600 dark:text-slate-400 text-sm font-medium hover:text-primary transition-colors"
              >
                Solutions
              </Link>
              <Link
                to="/ignite"
                className="text-slate-600 dark:text-slate-400 text-sm font-medium hover:text-primary transition-colors"
              >
                Learn
              </Link>
              <Link
                to="/articles"
                className="text-slate-600 dark:text-slate-400 text-sm font-medium hover:text-primary transition-colors"
              >
                Articles
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:block">
              <label className="relative block">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <span className="material-symbols-outlined text-[20px]">search</span>
                </span>
                <input
                  className="w-64 bg-slate-100 dark:bg-slate-800 border-none rounded-lg py-2 pl-10 pr-3 text-sm placeholder:text-slate-500 focus:ring-2 focus:ring-primary outline-none transition-all"
                  placeholder="Search registry..."
                  type="text"
                  value={searchQuery}
                  onChange={handleSearch}
                />
              </label>
            </div>
            <button
              onClick={handleProfileClick}
              className="size-10 rounded-full border border-slate-200 dark:border-slate-700 overflow-hidden bg-gradient-to-r from-primary to-purple-500 flex items-center justify-center text-white font-bold text-xs"
            >
              JD
            </button>
          </div>
        </header>

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
                      onChange={(e) => { setVerifiedOnly(e.target.checked); console.log('[Marketplace] Verified filter:', e.target.checked); }}
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
                      onChange={(e) => { setCommunityBuilt(e.target.checked); console.log('[Marketplace] Community filter:', e.target.checked); }}
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
                      onChange={(e) => { setOpenSource(e.target.checked); console.log('[Marketplace] Open Source filter:', e.target.checked); }}
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
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Marketplace</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed">
                  Deploy pre-trained design agents, specialized skills, and model-context protocol servers
                  directly to your development environment.
                </p>
              </div>
              <div className="flex items-center gap-2">
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
                <button
                  onClick={handleSort}
                  className="flex items-center gap-2 bg-slate-200 dark:bg-slate-800 px-4 py-2 rounded-lg text-sm font-medium"
                >
                  <span className="material-symbols-outlined text-[18px]">sort</span>
                  Popular
                </button>
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
                    {/* Icon + title + badge on same line */}
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
                            onClick={(e) => { e.stopPropagation(); handleShowInstructions(card.slug); }}
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

                    {/* Install Instructions Panel */}
                    {instructionsSlug === card.slug && (
                      <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Install & Setup Instructions</h4>
                          <button
                            onClick={() => setInstructionsSlug(null)}
                            className="text-slate-500 hover:text-white transition-colors"
                          >
                            <span className="material-symbols-outlined text-sm">close</span>
                          </button>
                        </div>
                        <div className="prose prose-sm prose-slate dark:prose-invert max-w-none prose-headings:text-sm prose-p:text-xs prose-li:text-xs prose-code:text-xs prose-pre:text-xs prose-pre:bg-slate-100 dark:prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-200 dark:prose-pre:border-slate-800 overflow-auto max-h-80">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {instructions[card.slug] || 'Loading instructions...'}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
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
    </div>
  );
};
