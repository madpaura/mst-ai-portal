"""Weighted user-journey scenarios.

A scenario is an ordered list of steps the engine executes back-to-back for one
virtual user. A step is either a catalog endpoint key, or the special token
``"HLS"`` which runs a full streaming session. ``think`` is the mean pause
(seconds) between steps, modelling real users reading the page.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List


HLS = "HLS"


@dataclass
class Scenario:
    name: str
    weight: float
    steps: List[str] = field(default_factory=list)
    think: float = 0.0   # mean think-time between steps (seconds); 0 = full throttle


# Realistic browse journeys. Auth-gated steps are only run when the engine has
# an identity pool; otherwise the engine skips them gracefully.
SCENARIOS: List[Scenario] = [
    Scenario("ignite_watch", 5, [
        "video.list", "video.courses", "video.detail",
        "video.chapters", "video.attachments", HLS,
    ], think=0.0),

    Scenario("ignite_browse", 4, [
        "video.list", "video.stats", "video.like_counts",
        "video.detail", "video.likes",
    ], think=0.0),

    Scenario("solutions_browse", 3, [
        "sol.landing", "sol.cards", "sol.card_detail",
        "sol.capabilities", "sol.news",
    ], think=0.0),

    Scenario("article_read", 3, [
        "art.categories", "art.list", "art.detail",
    ], think=0.0),

    Scenario("search_flow", 3, [
        "search.suggest", "search.query", "video.detail",
    ], think=0.0),

    Scenario("forge_browse", 2, [
        "forge.categories", "forge.components",
        "forge.component_detail", "forge.instructions",
    ], think=0.0),

    Scenario("authed_home", 2, [
        "auth.me", "video.progress", "video.my_courses",
        "video.bookmarks", "art.mine",
    ], think=0.0),
]


HLS_ONLY = Scenario("hls_stream", 1, [HLS], think=0.0)
