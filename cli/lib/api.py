"""Thin HTTP client wrapping the MST AI portal REST API."""
from __future__ import annotations

import requests
from pathlib import Path
from requests_toolbelt import MultipartEncoder, MultipartEncoderMonitor


class APIError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        super().__init__(f"API {status_code}: {message}")


class APIClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._session = requests.Session()
        self._session.headers.update({"Authorization": f"Bearer {token}"})

    # ── internal ────────────────────────────────────────────────────────────

    def _check(self, resp: requests.Response) -> requests.Response:
        if not resp.ok:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, str(detail))
        return resp

    def _get(self, path: str, **kwargs) -> requests.Response:
        return self._check(self._session.get(f"{self.base_url}{path}", **kwargs))

    def _post(self, path: str, **kwargs) -> requests.Response:
        return self._check(self._session.post(f"{self.base_url}{path}", **kwargs))

    # ── static helpers ───────────────────────────────────────────────────────

    @staticmethod
    def health_check(base_url: str) -> bool:
        try:
            resp = requests.get(f"{base_url.rstrip('/')}/health", timeout=5)
            return resp.ok
        except Exception:
            return False

    @staticmethod
    def login(base_url: str, username: str, password: str) -> str:
        url = f"{base_url.rstrip('/')}/auth/login"
        try:
            resp = requests.post(
                url,
                json={"username": username, "password": password},
                timeout=10,
            )
        except requests.ConnectionError:
            raise APIError(0, f"Cannot reach API at {base_url}")
        if not resp.ok:
            raise APIError(resp.status_code, "Login failed — check username/password")
        return resp.json()["access_token"]

    # ── video CRUD ───────────────────────────────────────────────────────────

    def create_video(self, payload: dict) -> dict:
        return self._post("/admin/videos", json=payload).json()

    def get_video(self, video_id: str) -> dict:
        return self._get(f"/admin/videos/{video_id}").json()

    def resolve_video_id(self, slug_or_id: str) -> str:
        """Return the UUID for a slug-or-id string.

        Tries the value as a UUID path first; if that 404s it searches
        the video list for a matching slug.
        """
        import re
        _UUID_RE = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
        )
        if _UUID_RE.match(slug_or_id):
            return slug_or_id
        # Slug — search the admin list
        videos = self._get("/admin/videos").json()
        for v in videos:
            if v.get("slug") == slug_or_id:
                return v["id"]
        raise APIError(404, f"No video found with slug {slug_or_id!r}")


    def upload_video(
        self,
        video_id: str,
        file_path: Path,
        on_progress=None,
    ) -> None:
        url = f"{self.base_url}/admin/videos/{video_id}/upload"
        fh = open(file_path, "rb")
        encoder = MultipartEncoder(
            fields={"file": (file_path.name, fh, "application/octet-stream")}
        )
        if on_progress:
            monitor = MultipartEncoderMonitor(encoder, on_progress)
            data, content_type = monitor, monitor.content_type
        else:
            data, content_type = encoder, encoder.content_type

        resp = self._session.post(
            url, data=data, headers={"Content-Type": content_type}
        )
        fh.close()
        self._check(resp)

    def trigger_auto_process(self, video_id: str) -> None:
        self._post(f"/admin/videos/{video_id}/auto-process")

    def get_auto_status(self, slug_or_id: str) -> dict:
        vid = self.resolve_video_id(slug_or_id)
        return self._get(f"/admin/videos/{vid}/auto-status").json()
