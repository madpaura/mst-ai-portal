import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api } from '../api/client';
import { usePageView } from '../hooks/usePageView';
import { HlsPlayer } from '../components/HlsPlayer';

interface SolutionCard {
  id: string;
  title: string;
  subtitle: string | null;
  description: string;
  long_description: string | null;
  icon: string;
  icon_color: string;
  badge: string | null;
  link_url: string | null;
  launch_url: string | null;
  sort_order: number;
  category: string;
}

interface LandingFeature {
  title: string;
  description: string;
}

interface LandingConfig {
  video: { hls_path: string | null } | null;
  highlights: LandingFeature[];
}

export const Solutions: React.FC = () => {
  usePageView('/');
  const navigate = useNavigate();
  const [solutionCards, setSolutionCards] = useState<SolutionCard[]>([]);
  const [landingConfig, setLandingConfig] = useState<LandingConfig | null>(null);
  const [cardSearch, setCardSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set(['SW', 'HW', 'none']));
  const [contactEmail, setContactEmail] = useState('ai-tools@mst.internal');

  useEffect(() => {
    api.get<SolutionCard[]>('/api/solutions/cards').then(setSolutionCards).catch(() => {});
    api.get<LandingConfig>('/api/solutions/landing_page').then(setLandingConfig).catch(() => {});
    api.get<string | null>('/settings/contact_email').then((v) => { if (v) setContactEmail(v); }).catch(() => {});
  }, []);

  const handleGetStarted = () => navigate('/ignite');
  const handleWatchDemos = () => navigate('/ignite');
  const handlePlayVideo = () => navigate('/ignite');
  const handleContact = () => window.open(`mailto:${contactEmail}`, '_blank');
  const handleCardClick = (card: SolutionCard) => {
    if (card.link_url) navigate(card.link_url);
    else navigate(`/solutions/${card.id}`);
  };

  const toggleCategory = (cat: string) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) { if (next.size > 1) next.delete(cat); }
      else next.add(cat);
      return next;
    });
  };

  const filteredCards = solutionCards.filter((c) => {
    if (!categoryFilter.has(c.category || 'none')) return false;
    if (!cardSearch.trim()) return true;
    const q = cardSearch.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      (c.subtitle ?? '').toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    );
  });

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen font-sans">
      <Navbar variant="solutions" />

      <main className="relative pt-16">

        {/* ── Hero — compact, centered ────────────────────────────── */}
        <section className="relative py-6 flex flex-col items-center justify-center px-6 overflow-hidden circuit-bg pt-8">
          <div className="absolute inset-0 bg-primary/5 rounded-full blur-[120px] pointer-events-none opacity-40" />

          <div className="relative z-10 text-center max-w-xl mx-auto">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white mb-4 leading-snug">
              Transform your workflows with{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400 dark:glow-text">
                AI Assisted
              </span>{' '}
              solutions
            </h1>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleGetStarted}
                className="w-full sm:w-auto px-6 py-2.5 bg-primary text-white font-bold rounded-lg text-sm hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/20"
              >
                Get Started
              </button>
              <button
                onClick={handleContact}
                className="w-full sm:w-auto px-6 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-900 dark:text-white font-bold rounded-lg text-sm border border-slate-300 dark:border-slate-700 transition-all"
              >
                Contact Us
              </button>
            </div>
          </div>
        </section>

        {/* ── Our Solutions ────────────────────────────────────────── */}
        {solutionCards.length > 0 && (
          <section className="max-w-7xl mx-auto px-6 py-16 border-t border-slate-200 dark:border-primary/10">
            <div className="flex flex-wrap items-center justify-between mb-8 gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Our Solutions</h2>
                <div className="h-1 w-16 bg-primary rounded-full mt-2" />
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                {/* Category checkboxes */}
                <div className="flex items-center gap-3">
                  {(['SW', 'HW', 'none'] as const).map((cat) => (
                    <label key={cat} className="flex items-center gap-1.5 cursor-pointer select-none group">
                      <input
                        type="checkbox"
                        checked={categoryFilter.has(cat)}
                        onChange={() => toggleCategory(cat)}
                        className="w-3.5 h-3.5 accent-primary rounded"
                      />
                      <span className={`text-xs font-semibold transition-colors ${
                        categoryFilter.has(cat)
                          ? cat === 'SW' ? 'text-blue-500' : cat === 'HW' ? 'text-amber-500' : 'text-slate-400'
                          : 'text-slate-400 opacity-50'
                      }`}>
                        {cat === 'none' ? 'Other' : cat}
                      </span>
                    </label>
                  ))}
                </div>
                {/* Search */}
                <label className="relative block shrink-0">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 pointer-events-none">
                    <span className="material-symbols-outlined text-[18px]">search</span>
                  </span>
                  <input
                    type="text"
                    value={cardSearch}
                    onChange={(e) => setCardSearch(e.target.value)}
                    placeholder="Search solutions…"
                    className="w-52 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:ring-2 focus:ring-primary outline-none transition-all"
                  />
                  {cardSearch && (
                    <button
                      onClick={() => setCardSearch('')}
                      className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-white"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  )}
                </label>
              </div>
            </div>

            <div
              className="grid gap-6 overflow-y-auto pr-1"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                maxHeight: '640px',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(37,140,244,0.25) transparent',
              }}
            >
              {filteredCards.length > 0 ? filteredCards.map((card) => (
                <div
                  key={card.id}
                  onClick={() => handleCardClick(card)}
                  className="glass-card p-8 rounded-2xl flex flex-col gap-6 group cursor-pointer hover:border-primary/30 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className={`w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center ${card.icon_color} group-hover:bg-primary group-hover:text-white transition-all duration-300`}>
                      <span className="material-symbols-outlined text-3xl">{card.icon}</span>
                    </div>
                    {card.badge && (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                        {card.badge}
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1.5 leading-snug">{card.title}</h3>
                    {card.subtitle && (
                      <p className="text-sm text-primary font-semibold uppercase tracking-wider mb-3">{card.subtitle}</p>
                    )}
                    <p className="text-slate-500 dark:text-slate-400 text-[15px] leading-relaxed">{card.description}</p>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1 text-primary text-sm font-medium group-hover:gap-2 transition-all">
                      Learn more
                      <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    </div>
                    {card.launch_url && (
                      <a
                        href={card.launch_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary text-primary hover:text-white border border-primary/20 hover:border-primary text-xs font-bold rounded-lg transition-all"
                      >
                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                        Launch
                      </a>
                    )}
                  </div>
                </div>
              )) : (
                <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-400">
                  <span className="material-symbols-outlined text-4xl mb-3">search_off</span>
                  <p className="text-sm">No solutions match your current filters</p>
                  <button onClick={() => { setCardSearch(''); setCategoryFilter(new Set(['SW', 'HW', 'none'])); }} className="mt-3 text-xs text-primary hover:underline">Clear all filters</button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── See it in Action ─────────────────────────────────────── */}
        <section className="max-w-7xl mx-auto px-6 py-24 border-t border-slate-200 dark:border-primary/10">
          <div className="flex flex-col lg:flex-row gap-16 items-center">
            <div className="w-full lg:w-2/3">
              <div className="mb-8">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">See it in Action</h2>
                <div className="h-1 w-20 bg-primary rounded-full" />
              </div>

              <div className="relative group min-h-[300px] w-full flex">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-blue-500/50 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
                <div className="relative bg-black rounded-2xl overflow-hidden neon-border-glow aspect-video flex-1 flex items-center justify-center">
                  {landingConfig?.video?.hls_path ? (
                    <HlsPlayer hlsPath={landingConfig.video.hls_path} className="w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 bg-slate-900 flex flex-col">
                      <div className="h-8 bg-slate-800 border-b border-white/5 flex items-center px-4 gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <div className="w-2 h-2 rounded-full bg-yellow-500" />
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-[10px] text-slate-400 ml-4 font-mono">top_module.v — CodeAgent IDE</span>
                      </div>
                      <div className="flex-1 p-6 font-mono text-sm overflow-hidden">
                        <div className="flex gap-4"><span className="text-slate-600 select-none">1</span><span className="text-blue-400">module</span><span className="text-white">top_module(</span></div>
                        <div className="flex gap-4"><span className="text-slate-600 select-none">2</span><span className="text-slate-400 ml-4">input wire clk,</span></div>
                        <div className="flex gap-4"><span className="text-slate-600 select-none">3</span><span className="text-slate-400 ml-4">input wire rst_n,</span></div>
                        <div className="flex gap-4 items-center animate-pulse">
                          <span className="text-slate-600 select-none">4</span>
                          <span className="text-primary bg-primary/10 px-1 rounded border border-primary/20">Agent: Generating RTL logic for AXI Bridge...</span>
                        </div>
                        <div className="flex gap-4 mt-2"><span className="text-slate-600 select-none">5</span><span className="text-slate-400 ml-4">reg [31:0] data_reg;</span></div>
                        <div className="flex gap-4"><span className="text-slate-600 select-none">6</span><span className="text-slate-400 ml-4">always @(posedge clk or negedge rst_n) begin</span></div>
                        <div className="flex gap-4"><span className="text-slate-600 select-none">7</span><span className="text-slate-400 ml-8">if (!rst_n) data_reg &lt;= 32&apos;h0;</span></div>
                      </div>
                      <div className="h-12 bg-slate-900/80 backdrop-blur-sm border-t border-white/5 flex items-center px-6 gap-6">
                        <button onClick={handlePlayVideo} className="text-white/80 cursor-pointer hover:text-primary transition-colors">
                          <span className="material-symbols-outlined">play_arrow</span>
                        </button>
                        <div className="flex-1 h-1 bg-slate-700 rounded-full relative">
                          <div className="absolute top-0 left-0 w-1/3 h-full bg-primary rounded-full shadow-[0_0_8px_rgba(37,140,244,0.6)]" />
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">01:24 / 04:15</span>
                        <button onClick={() => console.log('[Solutions] Settings clicked')} className="text-white/80 cursor-pointer hover:text-primary transition-colors">
                          <span className="material-symbols-outlined">settings</span>
                        </button>
                        <button onClick={() => console.log('[Solutions] Fullscreen clicked')} className="text-white/80 cursor-pointer hover:text-primary transition-colors">
                          <span className="material-symbols-outlined">fullscreen</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Workflow Highlights */}
            <div className="w-full lg:w-1/3 flex flex-col gap-8">
              <div className="glass-card p-8 rounded-2xl border-l-4 border-l-primary">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Workflow Highlights</h3>
                <ul className="space-y-6">
                  {(landingConfig?.highlights?.length ? landingConfig.highlights : [
                    { title: 'Describe the spec', description: 'Provide natural language or architectural block diagrams to initialize the agent.' },
                    { title: 'Agent generates RTL', description: 'The AI constructs syntactically correct and vendor-compliant Verilog/SystemVerilog.' },
                    { title: 'Real-time validation', description: 'Instant syntax checks and logical verification against existing design constraints.' }
                  ]).map((h, index) => (
                    <li key={index} className="flex items-start gap-4">
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary font-bold text-sm">
                        {index + 1}
                      </span>
                      <div>
                        <h4 className="text-slate-900 dark:text-white font-semibold text-base">{h.title}</h4>
                        <p className="text-slate-500 dark:text-slate-400 text-[15px] mt-1.5 leading-relaxed">{h.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={handleWatchDemos}
                className="w-full py-4 px-6 rounded-xl border border-primary/30 bg-primary/5 text-primary font-bold hover:bg-primary/10 transition-all flex items-center justify-center gap-3 group"
              >
                Watch All Demos
                <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </button>
            </div>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
};
