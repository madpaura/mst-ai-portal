"""Editorial email template generator — fully inline styles, email-client compatible."""
from datetime import datetime
from typing import Optional

# Reusable font stacks (inline, no @import needed)
_MONO = "font-family:'IBM Plex Mono',Courier New,Courier,monospace;"
_SERIF = "font-family:'Playfair Display',Georgia,'Times New Roman',serif;"
_SANS = "font-family:Arial,Helvetica,sans-serif;"

# Email-safe inline logo block (HTML table, no SVG required)
_LOGO_HTML = """
<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
  <tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:36px;height:36px;background:#0D1F35;border-radius:8px;text-align:center;vertical-align:middle;border:1.5px solid #258CF4;">
            <span style="font-family:Arial,sans-serif;font-size:16px;font-weight:900;color:#258CF4;letter-spacing:-1px;">M</span>
          </td>
        </tr>
      </table>
    </td>
    <td style="vertical-align:middle;">
      <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1614;letter-spacing:-0.3px;line-height:1;">MST AI</div>
      <div style="font-family:'IBM Plex Mono',Courier New,monospace;font-size:9px;color:#999;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px;">Internal Portal</div>
    </td>
  </tr>
</table>"""


def generate_portal_spotlight_email(
    issue_title: str,
    issue_number: int,
    featured_item: dict,
    featured_items: list,
    stats: dict,
    featured_series: Optional[dict] = None,
    cta_text: str = "Explore the full library",
    cta_link: str = "http://localhost:9810",
    issue_label: str = None,
) -> str:
    """Single-item portal-branded email (article / video / marketplace spotlight).

    Same visual system as generate_digest_email (navy header, blue accent,
    rounded item cards, stat bar) so single-item "publish" emails match the
    Learning Digest theme (issue #280). Drop-in replacement for the old
    generate_editorial_email — same call signature, different visuals.
    """
    today = datetime.utcnow().strftime("%b %d, %Y")

    PRIMARY = "#258CF4"
    NAVY = "#0D1F35"
    ACCENT = "#f59e0b"       # amber — matches the Featured spotlight tile
    ACCENT_RELATED = "#8b5cf6"

    CARD_STYLE = (
        "background:#ffffff;border:1px solid #e2e8f0;"
        "border-radius:14px;overflow:hidden;margin-bottom:24px;"
    )

    def _stripe(accent: str) -> str:
        return f'height:4px;background:linear-gradient(90deg,{accent} 0%,{PRIMARY} 100%);'

    def _item_card(item: dict, accent: str, big: bool = False) -> str:
        title_size = "22px" if big else "16px"
        desc_size = "14.5px" if big else "13.5px"
        pad = "24px 26px" if big else "18px 20px"
        meta = ""
        meta_bits = " &middot; ".join(x for x in [item.get('duration', ''), item.get('author', '')] if x)
        if meta_bits:
            meta = f'<div style="{_SANS}font-size:11.5px;color:#94a3b8;margin-top:8px;">{meta_bits}</div>'
        return f"""
        <div style="{_SANS}background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:{pad};margin-bottom:12px;">
          <a href="{item.get('link','#')}" style="text-decoration:none;color:inherit;display:block;">
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:9px;">
              <tr>
                <td><span style="{_SANS}font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:{accent};background:{accent}1a;padding:4px 9px;border-radius:999px;">{item.get('tag','Featured')}</span></td>
                <td style="text-align:right;"><span style="{_SANS}font-size:11px;color:#94a3b8;">{item.get('category','')}</span></td>
              </tr>
            </table>
            <div style="{_SANS}font-size:{title_size};font-weight:700;color:#0f172a;margin-bottom:7px;line-height:1.35;letter-spacing:-0.01em;">{item.get('title','')}</div>
            <p style="{_SANS}font-size:{desc_size};color:#64748b;line-height:1.6;margin:0;">{item.get('description','')}</p>
            {meta}
            <div style="margin-top:12px;"><span style="{_SANS}font-size:12px;font-weight:700;color:{PRIMARY};">View &#8599;</span></div>
          </a>
        </div>"""

    def _section_hdr(title: str, count: str, accent: str) -> str:
        return (
            f'<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:10px;">'
            f'<tr>'
            f'<td><span style="{_SANS}font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:{accent};">{title}</span></td>'
            f'<td style="text-align:right;"><span style="{_SANS}font-size:11px;color:#94a3b8;">{count}</span></td>'
            f'</tr></table>'
            f'<div style="height:1px;background:#e2e8f0;margin-bottom:16px;"></div>'
        )

    # ── Stats bar — same 4-tile layout as generate_digest_email's header ──
    stat_accents = [ACCENT, ACCENT_RELATED, PRIMARY, "#06b6d4"]
    stats_cells = ""
    for i, (label, value) in enumerate(list(stats.items())[:4]):
        sep = "border-left:1px solid rgba(255,255,255,0.08);" if i > 0 else ""
        accent = stat_accents[i % len(stat_accents)]
        stats_cells += (
            f'<td style="width:25%;padding:16px 10px;text-align:center;vertical-align:top;{sep}">'
            f'<div style="{_SANS}font-size:22px;font-weight:800;color:{accent};line-height:1;margin-bottom:6px;">{value}</div>'
            f'<div style="{_SANS}font-size:9.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#7d93b2;">{label}</div>'
            f'</td>'
        )
    stats_bar = (
        f'<table cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;overflow:hidden;">'
        f'<tr>{stats_cells}</tr></table>'
    )

    # ── Series (optional) ──────────────────────────────────
    series_html = ""
    if featured_series:
        chips = ""
        for i, tag in enumerate(featured_series.get("tags", [])[:4]):
            is_hot = i == 0
            chip_bg = "rgba(37,140,244,0.08)" if is_hot else "#f1f5f9"
            chip_border = "rgba(37,140,244,0.3)" if is_hot else "#e2e8f0"
            chip_color = PRIMARY if is_hot else "#94a3b8"
            chips += f'<span style="{_SANS}font-size:10px;letter-spacing:0.1em;padding:5px 11px;border-radius:999px;display:inline-block;margin:0 6px 6px 0;background:{chip_bg};border:1px solid {chip_border};color:{chip_color};">{tag}</span>'
        series_html = f"""
    <div style="{CARD_STYLE}">
      <div style="{_stripe(PRIMARY)}"></div>
      <div style="padding:26px 44px;">
        <div style="{_SANS}font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:{PRIMARY};margin-bottom:8px;">{featured_series.get('meta','Multi-Part Series')}</div>
        <div style="{_SANS}font-size:20px;font-weight:800;color:#0f172a;margin-bottom:10px;">{featured_series.get('name','')}</div>
        <p style="{_SANS}font-size:14px;color:#64748b;line-height:1.65;margin:0 0 16px 0;">{featured_series.get('description','')}</p>
        <div>{chips}</div>
      </div>
    </div>"""

    # ── Related items (optional) ───────────────────────────
    related_html = ""
    if featured_items:
        related_cards = "".join(_item_card(it, ACCENT_RELATED) for it in featured_items)
        related_html = f"""
    <div style="{CARD_STYLE}">
      <div style="{_stripe(ACCENT_RELATED)}"></div>
      <div style="padding:30px 44px;">
        {_section_hdr("Related", f"{len(featured_items)} more", ACCENT_RELATED)}
        {related_cards}
      </div>
    </div>"""

    logo_dark_bg = _LOGO_HTML.replace('color:#1a1614;', 'color:#ffffff;').replace('color:#999;', 'color:#7d93b2;')

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>MST AI Portal &mdash; {issue_title}</title>
</head>
<body style="margin:0;padding:36px 16px;background:#eef2f7;{_SANS}color:#0f172a;">

<div style="max-width:680px;margin:0 auto;">

  <!-- ══ HEADER CARD (portal navy) ══ -->
  <div style="background:{NAVY};border:1px solid #1b3a5f;border-radius:14px;overflow:hidden;margin-bottom:24px;">
    <div style="{_stripe(PRIMARY)}"></div>
    <div style="padding:38px 44px 30px;">
      {logo_dark_bg}
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="vertical-align:top;">
            <div style="{_SANS}font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:{PRIMARY};margin-bottom:10px;">
              {issue_label or f"Portal Update &middot; Issue No. {issue_number}"}
            </div>
            <h1 style="{_SANS}font-size:30px;line-height:1.2;color:#ffffff;letter-spacing:-0.02em;margin:0;font-weight:800;">{issue_title}</h1>
          </td>
          <td style="text-align:right;vertical-align:top;padding-left:16px;white-space:nowrap;">
            <div style="{_SANS}font-size:11px;color:#7d93b2;">{today}</div>
          </td>
        </tr>
      </table>
    </div>
    <div style="margin:0 44px 30px;">
      {stats_bar}
    </div>
  </div>

  <!-- ══ FEATURED ══ -->
  <div style="{CARD_STYLE}">
    <div style="{_stripe(ACCENT)}"></div>
    <div style="padding:30px 44px;">
      {_section_hdr("Featured", featured_item.get('category', 'Update'), ACCENT)}
      {_item_card(featured_item, ACCENT, big=True)}
    </div>
  </div>

  {series_html}

  {related_html}

  <!-- ══ CTA + FOOTER ══ -->
  <div style="{CARD_STYLE}">
    <div style="background:{NAVY};padding:26px 44px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="vertical-align:middle;">
            <div style="{_SANS}font-size:19px;font-weight:800;color:#ffffff;margin-bottom:4px;">{cta_text}</div>
            <div style="{_SANS}font-size:13px;color:#7d93b2;">Stream, download &amp; share with your team</div>
          </td>
          <td style="text-align:right;vertical-align:middle;padding-left:16px;white-space:nowrap;">
            <a href="{cta_link}"
               style="display:inline-block;background:{PRIMARY};color:#fff;{_SANS}font-size:12.5px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;">Open Portal &#8599;</a>
          </td>
        </tr>
      </table>
    </div>
    <div style="padding:20px 44px;border-top:1px solid #e2e8f0;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="vertical-align:top;">
            <div style="{_SANS}font-size:11.5px;color:#94a3b8;line-height:1.8;">
              <strong style="color:#64748b;display:block;">MST AI &middot; Internal Portal</strong>
              {today}
            </div>
          </td>
          <td style="text-align:right;vertical-align:top;">
            <a href="{cta_link}" style="{_SANS}font-size:11.5px;color:#94a3b8;text-decoration:underline;margin-left:16px;">Portal</a>
            <a href="{cta_link}" style="{_SANS}font-size:11.5px;color:#94a3b8;text-decoration:underline;margin-left:16px;">Unsubscribe</a>
          </td>
        </tr>
      </table>
    </div>
  </div>

</div>
</body>
</html>"""

    return html


def _build_chips(tags: list) -> str:
    """Build chip HTML for series tags (inline styles)"""
    chips = ""
    for i, tag in enumerate(tags[:4]):
        is_hot = i == 0
        chip_bg = "rgba(232,72,48,0.06)" if is_hot else "#f5f2ef"
        chip_border = "rgba(232,72,48,0.3)" if is_hot else "#e0ddd8"
        chip_color = "#e84830" if is_hot else "#888"
        chips += (
            f'<span style="{_MONO}font-size:10px;letter-spacing:0.1em;color:{chip_color};'
            f'background:{chip_bg};border:1px solid {chip_border};padding:4px 10px;'
            f'border-radius:2px;margin-right:6px;display:inline-block;">{tag}</span>'
        )
    return chips


def generate_digest_email(
    days: int,
    stats: dict,
    learning_items: list,
    learning_summary: str,
    marketplace_items: list,
    marketplace_summary: str,
    article_items: list,
    articles_summary: str,
    announcements: list = None,
    custom_content: str = None,
    portal_url: str = "http://localhost:9810",
    issue_number: int = None,
) -> str:
    today = datetime.utcnow().strftime("%b %d, %Y")

    # Portal design guide (issue #280): primary blue #258CF4, navy surfaces
    # (#0D1F35 — matches the logo block), slate neutrals, rounded cards.
    # Table layout + inline styles only, for mail-client compatibility.
    PRIMARY = "#258CF4"
    NAVY = "#0D1F35"
    ACCENT_VIDEOS = "#f59e0b"      # amber — matches the landing Videos tile
    ACCENT_MARKET = "#8b5cf6"      # violet — Marketplace tile
    ACCENT_ARTICLES = "#06b6d4"    # cyan — Articles tile

    CARD_STYLE = (
        "background:#ffffff;border:1px solid #e2e8f0;"
        "border-radius:14px;overflow:hidden;margin-bottom:24px;"
    )

    def _stripe(accent: str) -> str:
        return f'height:4px;background:linear-gradient(90deg,{accent} 0%,{PRIMARY} 100%);'

    def _item_cards(items: list, accent: str, icon: str) -> str:
        if not items:
            return f'<p style="{_SANS}color:#94a3b8;font-size:14px;padding:14px 0;">No new items this period.</p>'
        cards = ""
        for item in items:
            cards += f"""
        <div style="{_SANS}background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;margin-bottom:12px;">
          <a href="{item.get('link','#')}" style="text-decoration:none;color:inherit;display:block;">
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:9px;">
              <tr>
                <td><span style="{_SANS}font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:{accent};background:{accent}1a;padding:4px 9px;border-radius:999px;">{item.get('tag','New')}</span></td>
                <td style="text-align:right;"><span style="{_SANS}font-size:11px;color:#94a3b8;">{item.get('category','')}</span></td>
              </tr>
            </table>
            <div style="{_SANS}font-size:16px;font-weight:700;color:#0f172a;margin-bottom:7px;line-height:1.35;letter-spacing:-0.01em;">{item.get('title','')}</div>
            <p style="{_SANS}font-size:13.5px;color:#64748b;line-height:1.6;margin:0 0 11px 0;">{item.get('description','')}</p>
            <a href="{item.get('link','#')}" style="{_SANS}font-size:12px;font-weight:700;color:{PRIMARY};text-decoration:none;">View {icon} &#8599;</a>
          </a>
        </div>"""
        return cards

    def _page_nav(current: int) -> str:
        pages = [(1, "Videos"), (2, "Marketplace"), (3, "Articles")]
        cells = ""
        for num, label in pages:
            is_active = num == current
            bg = PRIMARY if is_active else "#f1f5f9"
            color = "#fff" if is_active else "#94a3b8"
            weight = "700" if is_active else "500"
            cells += (
                f'<td style="padding:0 3px;"><span style="{_SANS}display:inline-block;'
                f'padding:6px 15px;background:{bg};color:{color};font-size:11.5px;'
                f'font-weight:{weight};border-radius:999px;">{label}</span></td>'
            )
        return (
            f'<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 18px;">'
            f'<tr>{cells}</tr></table>'
        )

    # Stats bar (table-based, no flex) — light tiles on the navy header
    stat_accents = [ACCENT_VIDEOS, ACCENT_MARKET, PRIMARY, ACCENT_ARTICLES]
    stats_cells = ""
    for i, (label, value) in enumerate(list(stats.items())[:4]):
        sep = "border-left:1px solid rgba(255,255,255,0.08);" if i > 0 else ""
        accent = stat_accents[i % len(stat_accents)]
        stats_cells += (
            f'<td style="width:25%;padding:16px 10px;text-align:center;vertical-align:top;{sep}">'
            f'<div style="{_SANS}font-size:28px;font-weight:800;color:{accent};line-height:1;margin-bottom:6px;">{value}</div>'
            f'<div style="{_SANS}font-size:9.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#7d93b2;">{label}</div>'
            f'</td>'
        )
    stats_bar = (
        f'<table cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;overflow:hidden;">'
        f'<tr>{stats_cells}</tr></table>'
    )

    # Announcements
    ann_html = ""
    if announcements:
        ann_items = ""
        for ann in announcements[:3]:
            badge = ann.get("badge", "")
            badge_html = (
                f'<span style="{_SANS}font-size:9.5px;font-weight:700;background:{PRIMARY};color:#fff;'
                f'padding:2px 8px;border-radius:999px;margin-right:8px;">{badge}</span>'
                if badge else ""
            )
            ann_items += (
                f'<div style="{_SANS}padding:11px 0;border-bottom:1px solid rgba(255,255,255,0.08);'
                f'font-size:13.5px;color:#a8bad1;">'
                f'{badge_html}<strong style="color:#e8eef6;">{ann.get("title","")}</strong>'
                f' &mdash; {ann.get("content","")}</div>'
            )
        ann_html = (
            f'<div style="margin:20px 0 0 0;">'
            f'<div style="{_SANS}font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;'
            f'color:{PRIMARY};margin-bottom:8px;">Announcements</div>'
            f'{ann_items}</div>'
        )

    # Custom content
    custom_html = ""
    if custom_content:
        custom_html = (
            f'<div style="margin:20px 0 0 0;padding:16px 20px;background:rgba(37,140,244,0.08);'
            f'border-left:3px solid {PRIMARY};border-radius:10px;">'
            f'<div style="{_SANS}font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;'
            f'color:{PRIMARY};margin-bottom:7px;">Message from the team</div>'
            f'<p style="{_SANS}font-size:13.5px;color:#c3d2e4;line-height:1.65;margin:0;">{custom_content}</p>'
            f'</div>'
        )

    section_hdr = lambda title, count, accent: (
        f'<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:10px;">'
        f'<tr>'
        f'<td><span style="{_SANS}font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:{accent};">{title}</span></td>'
        f'<td style="text-align:right;"><span style="{_SANS}font-size:11px;color:#94a3b8;">{count}</span></td>'
        f'</tr></table>'
        f'<div style="height:1px;background:#e2e8f0;margin-bottom:16px;"></div>'
    )

    # Light-on-navy variant of the logo block for the header card
    logo_dark_bg = _LOGO_HTML.replace('color:#1a1614;', 'color:#ffffff;').replace('color:#999;', 'color:#7d93b2;')

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>MST AI Portal &mdash; Learning Digest</title>
</head>
<body style="margin:0;padding:36px 16px;background:#eef2f7;{_SANS}color:#0f172a;">

<div style="max-width:680px;margin:0 auto;">

  <!-- ══ HEADER CARD (portal navy) ══ -->
  <div style="background:{NAVY};border:1px solid #1b3a5f;border-radius:14px;overflow:hidden;margin-bottom:24px;">
    <div style="{_stripe(PRIMARY)}"></div>
    <div style="padding:38px 44px 30px;">
      {logo_dark_bg}
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="vertical-align:top;">
            <div style="{_SANS}font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:{PRIMARY};margin-bottom:10px;">
              Learning Digest &middot; {days}-Day Update{f" &mdash; Issue #{issue_number}" if issue_number else ""}
            </div>
            <h1 style="{_SANS}font-size:34px;line-height:1.12;color:#ffffff;letter-spacing:-0.02em;margin:0;font-weight:800;">
              What&rsquo;s new on the<br><span style="color:{PRIMARY};">MST AI Portal</span>
            </h1>
          </td>
          <td style="text-align:right;vertical-align:top;padding-left:16px;white-space:nowrap;">
            <div style="{_SANS}font-size:11px;color:#7d93b2;">{today}</div>
          </td>
        </tr>
      </table>
      <p style="{_SANS}margin:16px 0 0 0;font-size:14px;color:#a8bad1;line-height:1.65;max-width:460px;">
        Your curated update covering new videos, marketplace additions, and articles from the portal.
      </p>
      {custom_html}
    </div>
    <div style="margin:0 44px 30px;">
      {stats_bar}
    </div>
    {f'<div style="padding:0 44px 30px;">{ann_html}</div>' if ann_html else ''}
  </div>

  <!-- ══ PAGE 1: VIDEOS ══ -->
  <div style="{CARD_STYLE}">
    <div style="{_stripe(ACCENT_VIDEOS)}"></div>
    <div style="padding:30px 44px;">
      {_page_nav(1)}
      {section_hdr("Videos", f"{stats.get('videos','0')} new", ACCENT_VIDEOS)}
      {f'<p style="{_SANS}font-size:13.5px;color:#64748b;line-height:1.65;margin-bottom:16px;">{learning_summary}</p>' if learning_summary else ''}
      {_item_cards(learning_items, ACCENT_VIDEOS, 'Video')}
    </div>
  </div>

  <!-- ══ PAGE 2: MARKETPLACE ══ -->
  <div style="{CARD_STYLE}">
    <div style="{_stripe(ACCENT_MARKET)}"></div>
    <div style="padding:30px 44px;">
      {_page_nav(2)}
      {section_hdr("Marketplace &mdash; Components &amp; Solutions", f"{int(stats.get('marketplace','0'))+int(stats.get('solutions','0'))} items", ACCENT_MARKET)}
      {f'<p style="{_SANS}font-size:13.5px;color:#64748b;line-height:1.65;margin-bottom:16px;">{marketplace_summary}</p>' if marketplace_summary else ''}
      {_item_cards(marketplace_items, ACCENT_MARKET, 'Component')}
    </div>
  </div>

  <!-- ══ PAGE 3: ARTICLES ══ -->
  <div style="{CARD_STYLE}">
    <div style="{_stripe(ACCENT_ARTICLES)}"></div>
    <div style="padding:30px 44px;">
      {_page_nav(3)}
      {section_hdr("Articles &amp; Insights", f"{stats.get('articles','0')} new", ACCENT_ARTICLES)}
      {f'<p style="{_SANS}font-size:13.5px;color:#64748b;line-height:1.65;margin-bottom:16px;">{articles_summary}</p>' if articles_summary else ''}
      {_item_cards(article_items, ACCENT_ARTICLES, 'Article')}
    </div>
  </div>

  <!-- ══ CTA + FOOTER ══ -->
  <div style="{CARD_STYLE}">
    <div style="background:{NAVY};padding:26px 44px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="vertical-align:middle;">
            <div style="{_SANS}font-size:19px;font-weight:800;color:#ffffff;margin-bottom:4px;">Explore the full portal</div>
            <div style="{_SANS}font-size:13px;color:#7d93b2;">Stream, download &amp; share with your team</div>
          </td>
          <td style="text-align:right;vertical-align:middle;padding-left:16px;white-space:nowrap;">
            <a href="{portal_url}"
               style="display:inline-block;background:{PRIMARY};color:#fff;{_SANS}font-size:12.5px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;">Open Portal &#8599;</a>
          </td>
        </tr>
      </table>
    </div>
    <div style="padding:20px 44px;border-top:1px solid #e2e8f0;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="vertical-align:top;">
            <div style="{_SANS}font-size:11.5px;color:#94a3b8;line-height:1.8;">
              <strong style="color:#64748b;display:block;">MST AI &middot; Internal Portal</strong>
              {days}-day digest &middot; {today}
            </div>
          </td>
          <td style="text-align:right;vertical-align:top;">
            <a href="{portal_url}" style="{_SANS}font-size:11.5px;color:#94a3b8;text-decoration:underline;margin-left:16px;">Portal</a>
            <a href="{portal_url}" style="{_SANS}font-size:11.5px;color:#94a3b8;text-decoration:underline;margin-left:16px;">Unsubscribe</a>
          </td>
        </tr>
      </table>
    </div>
  </div>

</div>
</body>
</html>"""

    return html
