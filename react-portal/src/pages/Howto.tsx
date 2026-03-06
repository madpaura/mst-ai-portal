import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IgniteHeader } from '../components/IgniteHeader';
import { IgniteSidebar, ALL_VIDEOS } from '../components/IgniteSidebar';
import type { Video } from '../components/IgniteSidebar';

export const Howto: React.FC = () => {
  const navigate = useNavigate();
  const [activeVideo, setActiveVideo] = useState<Video>(ALL_VIDEOS[0]);
  const [activeSection, setActiveSection] = useState('env');

  const handleSelectVideo = (video: Video) => {
    setActiveVideo(video);
    navigate('/ignite');
  };

  const handleSectionClick = (sectionId: string) => {
    setActiveSection(sectionId);
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {});
  };

  const handleRelatedGuide = (_title: string) => {};
  const handleExternalResource = (_label: string) => {};

  const SECTIONS = [
    { id: 'env', label: 'Environment Configuration' },
    { id: 'ide', label: 'IDE Integration' },
    { id: 'pitfalls', label: 'Common Pitfalls' },
  ];

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen flex flex-col">
      <IgniteHeader />

      <div className="flex flex-1 overflow-hidden">
        <IgniteSidebar activeVideoId={activeVideo.id} onSelectVideo={handleSelectVideo} />

        <main className="flex-1 overflow-y-auto bg-background-light dark:bg-background-dark relative p-6 lg:p-10">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

          <div className="max-w-[1400px] mx-auto flex flex-col gap-6 relative z-10">
            {/* Page Header */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-primary/20 text-primary border border-primary/30 tracking-widest">
                  Internal Tool
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-accent/20 text-accent border border-accent/30 tracking-widest">
                  v2.4.0
                </span>
              </div>
              <h1 className="text-4xl font-bold text-slate-900 dark:text-white leading-tight">Getting Started with the Coding Agent</h1>
              <p className="text-slate-500 dark:text-slate-400 max-w-2xl">
                A comprehensive guide to configuring and deploying our internal LLM-powered assistant, specifically tuned
                for hardware description languages and firmware C/C++.
              </p>
            </div>

            {/* Three-column Layout */}
            <div className="flex gap-8 items-start">
              {/* Left Sidebar Navigation */}
              <aside className="w-64 shrink-0 sticky top-0 space-y-4">
                <nav className="flex flex-col gap-1">
                  {SECTIONS.map((section) => (
                    <button
                      key={section.id}
                      onClick={() => handleSectionClick(section.id)}
                      className={`px-4 py-2 rounded-lg text-sm text-left transition-all ${
                        activeSection === section.id
                          ? 'bg-primary/10 text-primary border-l-2 border-primary font-bold'
                          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {section.label}
                    </button>
                  ))}
                </nav>
              </aside>

              {/* Main Article Content */}
              <article className="flex-1 space-y-12 bg-card-light dark:bg-card-dark p-8 rounded-2xl border border-slate-200 dark:border-white/5 shadow-2xl">
                {/* Section 1: Environment Configuration */}
                <section id="env">
                  <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-900 dark:text-white mb-6">
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-white text-sm">1</span>
                    Environment Configuration
                  </h2>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
                    Before initializing the agent, ensure your workspace has the necessary SDKs and secure access tokens.
                    The agent requires an active VPN connection to the internal Silicon Forge network.
                  </p>

                  <div className="bg-slate-900 dark:bg-black rounded-lg p-4 font-mono text-sm border border-slate-700 dark:border-slate-800 my-6">
                    <div className="flex justify-between items-center mb-2 border-b border-white/10 pb-2">
                      <span className="text-slate-500 text-xs italic">Terminal / Shell</span>
                      <button
                        onClick={() => handleCopyCode('curl -s https://ai.internal.corp/install-cli | bash\nsai auth login --scope=chip-design\nsai init --agent=coding-assistant --env=development')}
                        className="text-primary hover:text-white text-xs flex items-center gap-1 transition-colors"
                      >
                        <span className="material-symbols-outlined text-sm">content_copy</span>
                        Copy
                      </button>
                    </div>
                    <div className="text-accent">
                      $ <span className="text-slate-300">curl -s https://ai.internal.corp/install-cli | bash</span>
                    </div>
                    <div className="text-accent">
                      $ <span className="text-slate-300">sai auth login --scope=chip-design</span>
                    </div>
                    <div className="text-slate-500 mt-2"># Initializing internal LLM weights...</div>
                    <div className="text-slate-300">sai init --agent=coding-assistant --env=development</div>
                  </div>

                  <div className="p-4 rounded-lg bg-accent/5 border-l-4 border-accent">
                    <div className="flex items-center gap-2 text-accent font-bold mb-2">
                      <span className="material-symbols-outlined">lightbulb</span>
                      <span>PRO TIP</span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      For faster inference, use the <code className="bg-slate-800 px-1 rounded">--local-cache</code> flag during initialization. This reduces latency by 40%.
                    </p>
                  </div>
                </section>

                {/* Section 2: IDE Integration */}
                <section id="ide">
                  <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-900 dark:text-white mb-6">
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-white text-sm">2</span>
                    IDE Integration
                  </h2>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
                    The Coding Agent works natively with VS Code and CLion. Install the{' '}
                    <span className="text-primary font-medium">&quot;Silicon-AI Copilot&quot;</span> extension from our internal marketplace.
                  </p>

                  <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/10 p-4 flex gap-6 items-center">
                    <div className="w-48 aspect-video bg-slate-100 dark:bg-black rounded-lg flex items-center justify-center border border-primary/20">
                      <span className="material-symbols-outlined text-4xl text-primary">integration_instructions</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-slate-900 dark:text-white mb-2 text-sm">Configuring Settings</h4>
                      <ul className="text-xs space-y-2 text-slate-400">
                        <li className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                          Enable &quot;Auto-complete for Verilog/VHDL&quot;
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                          Set Temperature to 0.1 for logic
                        </li>
                      </ul>
                    </div>
                  </div>
                </section>

                {/* Section 3: Common Pitfalls */}
                <section id="pitfalls">
                  <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-900 dark:text-white mb-6">
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-white text-sm">3</span>
                    Common Pitfalls
                  </h2>
                  <div className="space-y-4">
                    {[
                      {
                        icon: 'warning',
                        title: 'VPN Disconnection',
                        text: 'The agent requires a persistent VPN connection. If disconnected, all in-flight requests will be dropped.',
                      },
                      {
                        icon: 'error',
                        title: 'Token Expiry',
                        text: 'Auth tokens expire every 8 hours. Run `sai auth refresh` to renew without restarting the session.',
                      },
                      {
                        icon: 'info',
                        title: 'Model Version Mismatch',
                        text: 'Ensure your CLI version matches the server model version. Check with `sai version --check`.',
                      },
                    ].map((pitfall, idx) => (
                      <div key={idx} className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-white/5 flex items-start gap-4">
                        <span className="material-symbols-outlined text-yellow-400 mt-0.5">{pitfall.icon}</span>
                        <div>
                          <h4 className="text-slate-900 dark:text-white font-bold text-sm mb-1">{pitfall.title}</h4>
                          <p className="text-slate-500 dark:text-slate-400 text-sm">{pitfall.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </article>

              {/* Right Sidebar Quick Links */}
              <aside className="w-72 shrink-0 space-y-8">
                <div className="bg-card-light/50 dark:bg-card-dark/50 rounded-xl border border-slate-200 dark:border-white/5 p-5">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-primary mb-4">Related Guides</h3>
                  <div className="space-y-4">
                    <button onClick={() => handleRelatedGuide('Verilog Optimization')} className="group block text-left w-full">
                      <p className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors mb-1">
                        Verilog Optimization
                      </p>
                      <p className="text-[10px] text-slate-500">Advanced prompting for timing closure.</p>
                    </button>
                    <button onClick={() => handleRelatedGuide('Automated Unit Testing')} className="group block text-left w-full">
                      <p className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors mb-1">
                        Automated Unit Testing
                      </p>
                      <p className="text-[10px] text-slate-500">Generate testbenches in seconds.</p>
                    </button>
                  </div>
                </div>

                <div className="bg-card-light/50 dark:bg-card-dark/50 rounded-xl border border-slate-200 dark:border-white/5 p-5">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-primary mb-4">External Resources</h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => handleExternalResource('Internal Wiki')}
                      className="flex items-center justify-between p-2 rounded bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-white/5 hover:border-primary/50 text-[10px] font-medium w-full transition-colors"
                    >
                      <span>Internal Wiki</span>
                      <span className="material-symbols-outlined text-sm">open_in_new</span>
                    </button>
                    <button
                      onClick={() => handleExternalResource('API Docs')}
                      className="flex items-center justify-between p-2 rounded bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-white/5 hover:border-primary/50 text-[10px] font-medium w-full transition-colors"
                    >
                      <span>API Docs</span>
                      <span className="material-symbols-outlined text-sm">menu_book</span>
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
