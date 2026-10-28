# Run inside `pebble repl` with APP (app UUID string) and WAIT (seconds) defined.
# Restarts the app with app logs subscribed first, so the firmware's XS
# instrumentation ("instruments:" lines, only sent while a listener is
# connected and the app's creation record has kModdableCreationFlagLogInstrumentation)
# is captured from startup, and prints the peak of each counter.
import time, uuid
from libpebble2.protocol.logs import AppLogShippingControl, AppLogMessage
from libpebble2.protocol.apps import AppRunState, AppRunStateStart, AppRunStateStop

_lines = []
pebble.register_endpoint(AppLogMessage, lambda packet: _lines.append(packet.message))
pebble.send_packet(AppLogShippingControl(enable=True))
_app = uuid.UUID(APP)
pebble.send_packet(AppRunState(data=AppRunStateStop(uuid=_app)))
time.sleep(1.5)
pebble.send_packet(AppRunState(data=AppRunStateStart(uuid=_app)))
time.sleep(WAIT)
pebble.send_packet(AppLogShippingControl(enable=False))

_rows = [l.split("instruments:", 1)[1].strip() for l in _lines if "instruments:" in l]
_fatal = [l for l in _lines if "fxAbort" in l or "failed in fixed size heap" in l]
if _fatal:
    print("XSUSAGE FATAL " + " | ".join(_fatal))
elif not _rows:
    print("XSUSAGE NONE")
else:
    # Columns: Pixels drawn, Frames drawn, Timers, Files, Poco display list, Piu command list,
    # App bytes free, Chunk used, Chunk available, Slot used, Slot available, Stack used,
    # Stack available, Garbage collections, Keys used, Modules loaded, Parser used, ...
    _v = [[int(x) for x in r.split(",") if x.strip().lstrip("-").isdigit()] for r in _rows]
    _v = [r for r in _v if len(r) >= 15]
    peak = lambda i: max(r[i] for r in _v)
    low = lambda i: min(r[i] for r in _v)
    print("XSUSAGE samples=%d appfree_min=%d chunk_used=%d chunk_avail=%d slot_used=%d slot_avail=%d "
          "stack_used=%d stack_avail=%d gcs=%d keys=%d"
          % (len(_v), low(6), peak(7), peak(8), peak(9), peak(10), peak(11), peak(12), sum(r[13] for r in _v), peak(14)))
