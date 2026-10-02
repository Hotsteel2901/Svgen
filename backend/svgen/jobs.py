"""Background render jobs.

A synchronous HTTP render of an mp4 can block for a minute; the studio needs a
progress bar, a cancel button and a result it can fetch when it is ready. This
module owns that: one worker thread per job (bounded), a live progress record,
a cancellation event, and the finished bytes held in memory until they expire.

Deliberately dependency-free — `threading` and `queue` only.
"""

import threading
import time
import uuid

from .logs import log
from . import renderer

JOB_TTL = 30 * 60          # seconds a finished job (and its bytes) is kept
MAX_JOBS = 64
MAX_WORKERS = 4
RESULT_BYTE_LIMIT = 512 * 1024 * 1024   # refuse to buffer anything larger

QUEUED = "queued"
RUNNING = "running"
DONE = "done"
ERROR = "error"
CANCELLED = "cancelled"
TERMINAL = (DONE, ERROR, CANCELLED)


class Job:
    __slots__ = (
        "id", "request", "state", "stage", "done", "total", "message",
        "error", "result", "filename", "mime", "created", "started",
        "finished", "cancel_event", "_listeners", "_lock",
    )

    def __init__(self, request):
        self.id = uuid.uuid4().hex[:16]
        self.request = request
        self.state = QUEUED
        self.stage = "queued"
        self.done = 0
        self.total = 0
        self.message = ""
        self.error = None
        self.result = None
        self.filename = None
        self.mime = "application/octet-stream"
        self.created = time.time()
        self.started = None
        self.finished = None
        self.cancel_event = threading.Event()
        self._listeners = []
        self._lock = threading.Lock()

    # -- progress ---------------------------------------------------------
    def set_progress(self, stage, done=0, total=0):
        with self._lock:
            if self.state in TERMINAL:
                return
            self.state = RUNNING
            self.stage = stage or self.stage
            self.done = int(done)
            self.total = int(total)
        self._notify()

    def finish(self, data, filename, mime):
        with self._lock:
            self.result = data
            self.filename = filename
            self.mime = mime
            self.state = DONE
            self.stage = "done"
            self.done = self.total or 1
            self.total = self.total or 1
            self.finished = time.time()
        self._notify()

    def fail(self, message):
        with self._lock:
            self.error = message
            self.state = CANCELLED if self.cancel_event.is_set() else ERROR
            self.stage = self.state
            self.finished = time.time()
        self._notify()

    def cancel(self):
        self.cancel_event.set()
        with self._lock:
            if self.state == QUEUED:
                self.state = CANCELLED
                self.stage = CANCELLED
                self.finished = time.time()
        self._notify()

    @property
    def cancelled(self):
        return self.cancel_event.is_set()

    @property
    def terminal(self):
        return self.state in TERMINAL

    @property
    def percent(self):
        if self.state == DONE:
            return 100
        if not self.total:
            return None
        return max(0, min(100, int(round(self.done * 100.0 / self.total))))

    def to_dict(self, include_result=False):
        with self._lock:
            out = {
                "id": self.id,
                "state": self.state,
                "stage": self.stage,
                "done": self.done,
                "total": self.total,
                "percent": self.percent,
                "message": self.message,
                "error": self.error,
                "filename": self.filename,
                "mime": self.mime,
                "size": len(self.result) if self.result is not None else 0,
                "created": self.created,
                "started": self.started,
                "finished": self.finished,
                "elapsed": round((self.finished or time.time()) - (self.started or self.created), 2),
            }
        if include_result:
            out["request"] = self.request
        return out

    # -- listeners (SSE) --------------------------------------------------
    def subscribe(self, fn):
        with self._lock:
            self._listeners.append(fn)

    def unsubscribe(self, fn):
        with self._lock:
            try:
                self._listeners.remove(fn)
            except ValueError:
                pass

    def _notify(self):
        with self._lock:
            listeners = list(self._listeners)
        for fn in listeners:
            try:
                fn(self)
            except Exception:
                pass


class JobManager:
    def __init__(self, workers=MAX_WORKERS):
        self._jobs = {}
        self._order = []
        self._lock = threading.Lock()
        self._queue = []
        self._idle = threading.Condition(self._lock)
        self._workers = []
        self._stopping = False
        for i in range(max(1, workers)):
            t = threading.Thread(target=self._worker, name="svgen-job-%d" % i, daemon=True)
            t.start()
            self._workers.append(t)

    # -- lifecycle --------------------------------------------------------
    def submit(self, request):
        job = Job(request)
        with self._idle:
            self._jobs[job.id] = job
            self._order.append(job.id)
            self._queue.append(job)
            self._reap_locked()
            self._idle.notify()
        log.debug("job %s queued (%s -> %s)" % (job.id, request.get("format"), request.get("name")))
        return job

    def get(self, job_id):
        with self._lock:
            return self._jobs.get(job_id)

    def list(self):
        with self._lock:
            return [self._jobs[j].to_dict() for j in self._order if j in self._jobs]

    def cancel(self, job_id):
        job = self.get(job_id)
        if not job:
            return False
        job.cancel()
        return True

    def shutdown(self):
        with self._idle:
            self._stopping = True
            for job in list(self._jobs.values()):
                job.cancel()
            self._idle.notify_all()

    def _reap_locked(self):
        """Drop finished jobs whose results have expired, and enforce MAX_JOBS."""
        now = time.time()
        for jid in list(self._order):
            job = self._jobs.get(jid)
            if job is None:
                self._order.remove(jid)
                continue
            if job.terminal and job.finished and now - job.finished > JOB_TTL:
                self._jobs.pop(jid, None)
                self._order.remove(jid)
        while len(self._order) > MAX_JOBS:
            for jid in list(self._order):
                job = self._jobs.get(jid)
                if job is not None and job.terminal:
                    self._jobs.pop(jid, None)
                    self._order.remove(jid)
                    break
            else:
                break

    # -- worker -----------------------------------------------------------
    def _worker(self):
        while True:
            with self._idle:
                while not self._queue and not self._stopping:
                    self._idle.wait(timeout=1.0)
                if self._stopping and not self._queue:
                    return
                job = self._queue.pop(0) if self._queue else None
            if job is None:
                continue
            if job.cancelled:
                job.fail("cancelled")
                continue
            self._run(job)

    def _run(self, job):
        req = job.request
        job.started = time.time()
        job.set_progress("starting", 0, 1)
        try:
            data = renderer.render(
                req.get("svg", ""),
                req.get("format", "png"),
                width=req.get("width"),
                height=req.get("height"),
                duration=req.get("duration"),
                fps=req.get("fps", 30),
                background=req.get("background"),
                engine=req.get("engine", "auto"),
                quality=req.get("quality"),
                progress=lambda stage, done=0, total=0: job.set_progress(stage, done, total),
                cancel=job.cancelled,
            )
        except renderer.Cancelled:
            job.fail("cancelled")
            log.info("job %s cancelled" % job.id)
            return
        except renderer.RenderError as exc:
            job.fail(str(exc))
            log.warn("job %s failed: %s" % (job.id, exc))
            return
        except Exception as exc:  # noqa: BLE001 — never let a worker die
            import traceback

            log.error("job %s crashed: %s\n%s" % (job.id, exc, traceback.format_exc()))
            job.fail("%s: %s" % (type(exc).__name__, exc))
            return

        if job.cancelled:
            job.fail("cancelled")
            return
        if len(data) > RESULT_BYTE_LIMIT:
            job.fail("result too large (%d bytes)" % len(data))
            return

        fmt = renderer.normalize_format(req.get("format", "png"))
        name = req.get("name") or "artwork"
        filename = "%s.%s" % (name, fmt)
        job.finish(data, filename, _mime_for(fmt))
        log.info("job %s done: %s (%d bytes, %.1fs)" % (
            job.id, filename, len(data), (job.finished or time.time()) - (job.started or time.time())))


MIME_BY_EXT = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "bmp": "image/bmp",
    "webp": "image/webp",
    "gif": "image/gif",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "svg": "image/svg+xml",
}


def _mime_for(fmt):
    return MIME_BY_EXT.get(str(fmt).lower(), "application/octet-stream")


_manager = None
_manager_lock = threading.Lock()


def manager():
    """Process-wide job manager, created on first use."""
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = JobManager()
        return _manager
