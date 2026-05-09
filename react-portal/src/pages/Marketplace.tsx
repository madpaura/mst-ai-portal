import React, { useState, useEffect } from 'react';
import { Navbar } from '../components/Navbar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSearchParams } from 'react-router-dom';
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
  howto_guide_url: string | null;
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

const TYPE_DOT: Record<string, string> = {
  agent: 'bg-blue-500',
  skill: 'bg-amber-500',
  mcp_server: 'bg-purple-500',
};

interface ContributingGuide {
  video_slug: string | null;
  video_title: string | null;
  video_link: string | null;
}

export const Marketplace: React.FC = () => {
  usePageView('/marketplace');
  const [urlParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(urlParams.get('q') || '');
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredCards.map((card) => {
                const typeStyle = TYPE_BADGES[card.component_type] || TYPE_BADGES.agent;
                const badgeStyle = card.badge ? BADGE_STYLES[card.badge] : null;
                const dotColor = TYPE_DOT[card.component_type] || 'bg-slate-400';
                return (
                  <div
                    key={card.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 flex flex-col gap-2 hover:border-slate-300 dark:hover:border-slate-500 transition-colors cursor-pointer"
                    onClick={() => handleShowInstructions(card.slug, card.name)}
                  >
                    {/* Name + verification badge */}
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-primary leading-snug">{card.name}</h3>
                      {badgeStyle && (
                        <span className="shrink-0 px-2 py-0.5 text-[11px] rounded-full border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {badgeStyle.label}
                        </span>
                      )}
                    </div>

                    {/* Author */}
                    {card.author && (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">by {card.author}</p>
                    )}

                    {/* Description */}
                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed flex-1">
                      {card.description || '—'}
                    </p>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 mt-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`size-2.5 rounded-full shrink-0 ${dotColor}`} />
                        <span className="text-xs text-slate-500 dark:text-slate-400">{typeStyle.label}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400">
                        <span className="flex items-center gap-0.5 text-[11px]">
                          <span className="material-symbols-outlined text-[13px]">download</span>
                          {card.downloads}
                        </span>
                        {(card.howto_guide_url || card.howto_guide) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(card.howto_guide_url || `/marketplace/${card.slug}/howto`, '_blank');
                            }}
                            className="hover:text-primary transition-colors"
                            title="How-To Guide"
                          >
                            <span className="material-symbols-outlined text-[15px]">menu_book</span>
                          </button>
                        )}
                        {card.git_repo_url && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(card.slug); }}
                            disabled={downloading[card.slug]}
                            className="hover:text-green-500 transition-colors disabled:opacity-40"
                            title="Download as zip"
                          >
                            <span className={`material-symbols-outlined text-[15px] ${downloading[card.slug] ? 'animate-spin' : ''}`}>
                              {downloading[card.slug] ? 'progress_activity' : 'save_alt'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            ) : (
            <div className="flex flex-col gap-2">
              {filteredCards.map((card) => {
                const typeStyle = TYPE_BADGES[card.component_type] || TYPE_BADGES.agent;
                const badgeStyle = card.badge ? BADGE_STYLES[card.badge] : null;
                const dotColor = TYPE_DOT[card.component_type] || 'bg-slate-400';
                return (
                  <div
                    key={card.id}
                    className="px-4 py-4 flex items-center gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-slate-300 dark:hover:border-slate-500 transition-colors cursor-pointer"
                    onClick={() => handleShowInstructions(card.slug, card.name)}
                  >
                    {/* Name + description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-sm font-semibold text-primary leading-snug truncate">{card.name}</h3>
                        {badgeStyle && (
                          <span className="shrink-0 px-2 py-0.5 text-[10px] rounded-full border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {badgeStyle.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">{card.description || '—'}</p>
                    </div>
                    {/* Right: type indicator + download count + actions */}
                    <div className="flex items-center gap-2.5 shrink-0 text-slate-400">
                      <div className="flex items-center gap-1.5 hidden sm:flex">
                        <span className={`size-2 rounded-full shrink-0 ${dotColor}`} />
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">{typeStyle.label}</span>
                      </div>
                      <span className="flex items-center gap-0.5 text-[11px]">
                        <span className="material-symbols-outlined text-[13px]">download</span>
                        {card.downloads}
                      </span>
                      {(card.howto_guide_url || card.howto_guide) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(card.howto_guide_url || `/marketplace/${card.slug}/howto`, '_blank');
                          }}
                          className="hover:text-primary transition-colors"
                          title="How-To guide"
                        >
                          <span className="material-symbols-outlined text-[15px]">menu_book</span>
                        </button>
                      )}
                      {card.git_repo_url && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(card.slug); }}
                          disabled={downloading[card.slug]}
                          className="hover:text-green-500 transition-colors disabled:opacity-40"
                          title="Download as zip"
                        >
                          <span className={`material-symbols-outlined text-[15px] ${downloading[card.slug] ? 'animate-spin' : ''}`}>
                            {downloading[card.slug] ? 'progress_activity' : 'save_alt'}
                          </span>
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
