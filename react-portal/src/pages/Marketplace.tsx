import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from '../components/Navbar';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import 'highlight.js/styles/github-dark.css';
import '../styles/howto-markdown.css';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../api/auth';
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
  manual_install: string | null;
  badge: string | null;
  author: string | null;
  downloads: number;
  tags: string[];
  long_description: string | null;
  howto_guide: string | null;
  howto_guide_url: string | null;
  video_url: string | null;
  git_repo_url: string | null;
  git_ref: string | null;
  creator_user_id: string | null;
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
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [urlParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(urlParams.get('q') || '');
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeTab, setActiveTab] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [communityBuilt, setCommunityBuilt] = useState(false);
  const [openSource, setOpenSource] = useState(false);
  const [components, setComponents] = useState<ForgeComponent[]>([]);
  const [selectedCard, setSelectedCard] = useState<ForgeComponent | null>(null);
  const [drawerTab, setDrawerTab] = useState<'overview' | 'guide'>('overview');
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [installTab, setInstallTab] = useState<'skills' | 'manual'>('skills');
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


  // Install events already recorded this session, so repeated copies don't inflate the counter.
  const recordedInstalls = useRef<Set<string>>(new Set());

  // Optimistically reflect a new install/download in the visible counter.
  const bumpDownloadsLocal = (slug: string) => {
    setComponents((prev) => prev.map((c) => (c.slug === slug ? { ...c, downloads: c.downloads + 1 } : c)));
    setSelectedCard((prev) => (prev && prev.slug === slug ? { ...prev, downloads: prev.downloads + 1 } : prev));
  };

  const recordInstall = (slug: string) => {
    if (recordedInstalls.current.has(slug)) return;
    recordedInstalls.current.add(slug);
    bumpDownloadsLocal(slug);
    // Fire-and-forget — the counter is non-critical, so ignore failures.
    api.post(`/forge/components/${slug}/install`, {}).catch(() => {
      recordedInstalls.current.delete(slug);
    });
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
      // The download endpoint records the event server-side; mirror it in the UI.
      recordedInstalls.current.add(slug);
      bumpDownloadsLocal(slug);
    } catch {
      alert('Download failed. Please try again.');
    } finally {
      setDownloading((d) => ({ ...d, [slug]: false }));
    }
  };

  const handleShowCard = async (card: ForgeComponent) => {
    setSelectedCard(card);
    setDrawerTab('overview');
    setCopied(false);
    setInstallTab('skills');
    if (card.howto_guide || card.howto_guide_url) {
      // pre-load guide content if it lives inline
      if (card.howto_guide && !instructions[card.slug]) {
        setInstructions((prev) => ({ ...prev, [card.slug]: card.howto_guide! }));
      } else if (!card.howto_guide && !instructions[card.slug]) {
        try {
          const res = await api.get<{ instructions: string }>(`/forge/components/${card.slug}/instructions`);
          setInstructions((prev) => ({ ...prev, [card.slug]: res.instructions }));
        } catch {
          setInstructions((prev) => ({ ...prev, [card.slug]: '' }));
        }
      }
    }
  };

  const handleCopyInstall = (cmd: string, slug?: string) => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    // Copying the install command is the de-facto "install" — count it.
    if (slug) recordInstall(slug);
  };

  const handleSort = () => {};

  const handleDeleteComponent = async (card: ForgeComponent) => {
    if (!confirm(`Remove "${card.name}" from the marketplace? This cannot be undone without admin action.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/forge/components/${card.slug}`);
      setComponents(prev => prev.filter(c => c.id !== card.id));
      setSelectedCard(null);
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Failed to remove component');
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmitUpdate = (card: ForgeComponent) => {
    // Map component_type to artifact_type
    const typeMap: Record<string, string> = { agent: 'agent', skill: 'skill', mcp_server: 'mcp' };
    const artifactType = typeMap[card.component_type] || 'skill';
    navigate(`/admin/artifacts?parent_slug=${card.slug}&parent_type=${artifactType}`);
  };

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
      <div className="bg-background-light dark:bg-background-dark text-text-strong min-h-screen font-sans">
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
          <p className="text-base text-text-muted max-w-md leading-relaxed mb-8">
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
              className="px-6 py-2.5 bg-slate-100 dark:bg-slate-800 text-text font-bold rounded-lg text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-border-base"
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
    <div className="bg-background-light dark:bg-background-dark text-text-strong min-h-screen font-sans">
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
                <p className="text-xs text-text-muted mb-3 leading-relaxed">
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
                  <p className="text-sm text-text-muted max-w-2xl leading-relaxed">
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
                    className="bg-white dark:bg-slate-900 border border-border-base rounded-lg p-4 flex flex-col gap-2 hover:border-slate-300 dark:hover:border-slate-500 transition-colors cursor-pointer"
                    onClick={() => handleShowCard(card)}
                  >
                    {/* Name + verification badge */}
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-primary leading-snug">{card.name}</h3>
                      {badgeStyle && (
                        <span className="shrink-0 px-2 py-0.5 text-[11px] rounded-full border border-border-strong text-text-muted whitespace-nowrap">
                          {badgeStyle.label}
                        </span>
                      )}
                    </div>

                    {/* Author */}
                    {card.author && (
                      <p className="text-[11px] text-text-faint">by {card.author}</p>
                    )}

                    {/* Description */}
                    <p className="text-xs text-text-muted line-clamp-2 leading-relaxed flex-1">
                      {card.description || '—'}
                    </p>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 mt-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`size-2.5 rounded-full shrink-0 ${dotColor}`} />
                        <span className="text-xs text-text-muted">{typeStyle.label}</span>
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
                              handleShowCard(card);
                            }}
                            className="hover:text-primary transition-colors"
                            title="How-To Guide"
                          >
                            <span className="material-symbols-outlined text-[15px]">menu_book</span>
                          </button>
                        )}
                        {card.video_url && (
                          <button
                            onClick={(e) => { e.stopPropagation(); window.open(card.video_url!, '_blank'); }}
                            className="hover:text-rose-400 transition-colors"
                            title="Watch Video"
                          >
                            <span className="material-symbols-outlined text-[15px]">play_circle</span>
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
                    className="px-4 py-4 flex items-center gap-4 bg-white dark:bg-slate-900 border border-border-base rounded-lg hover:border-slate-300 dark:hover:border-slate-500 transition-colors cursor-pointer"
                    onClick={() => handleShowCard(card)}
                  >
                    {/* Name + description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-sm font-semibold text-primary leading-snug truncate">{card.name}</h3>
                        {badgeStyle && (
                          <span className="shrink-0 px-2 py-0.5 text-[10px] rounded-full border border-border-strong text-text-muted whitespace-nowrap">
                            {badgeStyle.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">{card.description || '—'}</p>
                    </div>
                    {/* Right: type indicator + download count + actions */}
                    <div className="flex items-center gap-2.5 shrink-0 text-slate-400">
                      <div className="flex items-center gap-1.5 hidden sm:flex">
                        <span className={`size-2 rounded-full shrink-0 ${dotColor}`} />
                        <span className="text-[11px] text-text-muted">{typeStyle.label}</span>
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
                      {card.video_url && (
                        <button
                          onClick={(e) => { e.stopPropagation(); window.open(card.video_url!, '_blank'); }}
                          className="hover:text-rose-400 transition-colors"
                          title="Watch Video"
                        >
                          <span className="material-symbols-outlined text-[15px]">play_circle</span>
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
        <footer className="bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-green-500" />
            MST Registry Online
          </span>
        </footer>
      </div>

      {/* Right-side detail drawer */}
      {selectedCard && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setSelectedCard(null)}
          />

          {/* Drawer */}
          <div className="fixed top-0 right-0 z-50 h-full w-full max-w-[420px] flex flex-col bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl">

            {/* ── Header ─────────────────────────────────────── */}
            <div className="shrink-0 px-5 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-start justify-between gap-3 mb-3">
                {/* Icon + name */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <span className={`material-symbols-outlined text-[22px] ${selectedCard.icon_color || 'text-primary'}`}>
                      {selectedCard.icon || 'smart_toy'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white leading-tight truncate">{selectedCard.name}</h2>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {selectedCard.version}
                      {selectedCard.author && <> · by <span className="text-text-muted">{selectedCard.author}</span></>}
                    </p>
                  </div>
                </div>

                {/* Action icons */}
                <div className="flex items-center gap-1 shrink-0">
                  {selectedCard.git_repo_url && (
                    <a
                      href={selectedCard.git_repo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title="GitHub"
                    >
                      <span className="material-symbols-outlined text-[18px]">code</span>
                    </a>
                  )}
                  {selectedCard.video_url && (
                    <a
                      href={selectedCard.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-rose-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                      title="Watch Video"
                    >
                      <span className="material-symbols-outlined text-[18px]">play_circle</span>
                    </a>
                  )}
                  <button
                    onClick={() => setSelectedCard(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-0 border-b border-slate-100 dark:border-slate-800 -mb-4">
                {(['overview', 'guide'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setDrawerTab(t)}
                    className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors capitalize ${drawerTab === t
                      ? 'border-primary text-primary'
                      : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                  >
                    {t === 'guide' ? 'How-To Guide' : 'Overview'}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Body ───────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">

              {/* OVERVIEW TAB */}
              {drawerTab === 'overview' && (
                <div className="p-5 space-y-5">

                  {/* Description */}
                  {selectedCard.description && (
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {selectedCard.description}
                    </p>
                  )}

                  {/* Tags */}
                  {selectedCard.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedCard.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 dark:bg-slate-800 text-text-muted border border-border-base">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">download</span>
                      {selectedCard.downloads.toLocaleString()} installs
                    </span>
                    {selectedCard.badge && (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <span className="material-symbols-outlined text-[14px]">verified</span>
                        {selectedCard.badge.replace('_', ' ')}
                      </span>
                    )}
                  </div>

                  {/* Creator / admin controls */}
                  {user && (isAdmin || selectedCard.creator_user_id === user.id) && (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleSubmitUpdate(selectedCard)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[15px]">upgrade</span>
                        Submit Update
                      </button>
                      <button
                        onClick={() => handleDeleteComponent(selectedCard)}
                        disabled={deleting}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                        {deleting ? '…' : 'Remove'}
                      </button>
                    </div>
                  )}

                  {/* GitHub repo info */}
                  {selectedCard.git_repo_url && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <div className="bg-slate-50 dark:bg-slate-900 px-4 py-3 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
                        <span className="material-symbols-outlined text-[15px] text-slate-400">source</span>
                        <span className="text-xs font-mono text-text-muted truncate">{selectedCard.git_repo_url.replace(/^https?:\/\//, '')}</span>
                      </div>
                      <div className="px-4 py-3">
                        {selectedCard.author && (
                          <p className="text-xs text-text-muted font-mono mb-3">
                            <span className="text-emerald-500">"author"</span>: <span className="text-amber-500">"{selectedCard.author}"</span>
                          </p>
                        )}
                        <a
                          href={selectedCard.git_repo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg border border-border-base text-sm font-semibold text-text hover:bg-surface-muted transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                          View GitHub Repository
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Install tabs */}
                  {(selectedCard.install_command || selectedCard.manual_install) && (() => {
                    const hasBoth = !!(selectedCard.install_command && selectedCard.manual_install);
                    const activeCmd = installTab === 'manual' && selectedCard.manual_install
                      ? selectedCard.manual_install
                      : selectedCard.install_command || selectedCard.manual_install || '';
                    const activeLabel = installTab === 'manual' && selectedCard.manual_install ? 'Manual' : 'CMD';
                    return (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                        <div className="bg-slate-800 dark:bg-slate-900 px-4 py-2 flex items-center justify-between border-b border-slate-700">
                          {hasBoth ? (
                            <div className="flex gap-1">
                              {(['skills', 'manual'] as const).map(tab => (
                                <button
                                  key={tab}
                                  onClick={() => setInstallTab(tab)}
                                  className={`px-2.5 py-1 text-[11px] font-mono rounded-md transition-colors ${
                                    (tab === 'skills' ? installTab !== 'manual' : installTab === 'manual')
                                      ? 'bg-slate-700 text-emerald-400'
                                      : 'text-slate-500 hover:text-slate-300'
                                  }`}
                                >
                                  {tab === 'skills' ? 'CMD' : 'manual'}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs font-mono text-slate-400">
                              <span className="text-slate-500">$</span> {activeLabel}
                            </span>
                          )}
                        </div>
                        <div className="bg-slate-900 px-4 py-3 flex items-start gap-3">
                          <code className="flex-1 text-xs font-mono text-emerald-400 break-all whitespace-pre-wrap">
                            {activeCmd}
                          </code>
                          <button
                            onClick={() => handleCopyInstall(activeCmd, selectedCard.slug)}
                            className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${copied ? 'text-emerald-400 bg-emerald-400/10' : 'text-slate-500 hover:text-white hover:bg-white/10'}`}
                            title="Copy"
                          >
                            <span className="material-symbols-outlined text-[16px]">{copied ? 'check' : 'content_copy'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Action buttons */}
                  <div className="space-y-2.5">
                    {selectedCard.video_url && (
                      <a
                        href={selectedCard.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">play_circle</span>
                        Watch Video
                      </a>
                    )}

                    {selectedCard.git_repo_url && (
                      <button
                        onClick={() => handleDownload(selectedCard.slug)}
                        disabled={downloading[selectedCard.slug]}
                        className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
                      >
                        <span className={`material-symbols-outlined text-[18px] ${downloading[selectedCard.slug] ? 'animate-spin' : ''}`}>
                          {downloading[selectedCard.slug] ? 'progress_activity' : 'save_alt'}
                        </span>
                        {downloading[selectedCard.slug] ? 'Downloading…' : 'Download ZIP'}
                      </button>
                    )}

                    {selectedCard.howto_guide_url && (
                      <a
                        href={selectedCard.howto_guide_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl border border-border-base text-text text-sm font-semibold hover:bg-surface-muted transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">menu_book</span>
                        Open Full Guide
                      </a>
                    )}

                    {(selectedCard.howto_guide || instructions[selectedCard.slug]) && (
                      <button
                        onClick={() => setDrawerTab('guide')}
                        className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">auto_stories</span>
                        Read How-To Guide
                      </button>
                    )}
                  </div>

                  {/* Long description */}
                  {selectedCard.long_description && (
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">About</p>
                      <div className="howto-markdown text-sm leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight, rehypeRaw]}>
                          {selectedCard.long_description}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* GUIDE TAB */}
              {drawerTab === 'guide' && (
                <div className="p-5">
                  {instructions[selectedCard.slug] ? (
                    <div className="howto-markdown text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight, rehypeRaw]}>
                        {instructions[selectedCard.slug]}
                      </ReactMarkdown>
                    </div>
                  ) : selectedCard.howto_guide_url ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                      <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600">open_in_new</span>
                      <p className="text-sm text-slate-500">This guide is hosted externally.</p>
                      <a
                        href={selectedCard.howto_guide_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-blue-600 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                        Open Guide
                      </a>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-16 text-slate-400">
                      <span className="material-symbols-outlined text-2xl animate-spin mr-2">progress_activity</span>
                      Loading guide…
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
