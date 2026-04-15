"""
Nightly scheduler for marketplace sync jobs (Issue #3).

Runs as a background asyncio task during the app lifespan.
Checks forge_settings for repos with scheduled update_frequency
and creates sync jobs accordingly.
"""

import asyncio
from datetime import datetime, timezone

import asyncpg
from loguru import logger as log


async def run_scheduler(db_url: str):
    """
    Long-running coroutine that checks every 60s whether any
    scheduled sync jobs need to be created based on update_frequency.
    """
    log.info("Forge sync scheduler started")

    while True:
        try:
            await asyncio.sleep(60)
            pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
            try:
                now = datetime.now(timezone.utc)
                hour = now.hour

                settings = await pool.fetch(
                    "SELECT * FROM forge_settings WHERE is_active = true"
                )

                for s in settings:
                    freq = s["update_frequency"]
                    should_run = False

                    if freq == "manual":
                        continue

                    # Check last completed job
                    last_job = await pool.fetchrow(
                        """SELECT completed_at FROM forge_sync_jobs
                           WHERE settings_id = $1 AND status = 'completed'
                           ORDER BY completed_at DESC LIMIT 1""",
                        s["id"],
                    )
                    last_run = last_job["completed_at"] if last_job else None

                    if freq == "hourly":
                        if not last_run or (now - last_run).total_seconds() >= 3600:
                            should_run = True
                    elif freq == "nightly":
                        # Run at 2 AM UTC
                        if hour == 2:
                            if not last_run or (now - last_run).total_seconds() >= 82800:
                                should_run = True
                    elif freq == "weekly":
                        # Run on Sundays at 3 AM UTC
                        if now.weekday() == 6 and hour == 3:
                            if not last_run or (now - last_run).total_seconds() >= 604800:
                                should_run = True

                    if should_run:
                        # Check no pending/running jobs exist
                        active = await pool.fetchval(
                            """SELECT COUNT(*) FROM forge_sync_jobs
                               WHERE settings_id = $1 AND status IN ('pending', 'running')""",
                            s["id"],
                        )
                        if active == 0:
                            row = await pool.fetchrow(
                                """INSERT INTO forge_sync_jobs (settings_id, trigger_type)
                                   VALUES ($1, 'scheduled') RETURNING id""",
                                s["id"],
                            )
                            log.info(f"Created sync job {row['id']} for {s['git_url']} ({freq})")

                            # Launch the sync worker
                            from forge.sync_worker import run_sync_job
                            asyncio.create_task(run_sync_job(row["id"], db_url))

            finally:
                await pool.close()

        except asyncio.CancelledError:
            log.info("Forge sync scheduler stopped")
            return
        except Exception as e:
            log.error(f"Scheduler error: {e}")
            await asyncio.sleep(30)
