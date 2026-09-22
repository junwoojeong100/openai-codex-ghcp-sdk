#!/usr/bin/env python3
"""An owned, reaped private PTY; stdin/stdout carry JSON control/receipts."""

import base64
import errno
import fcntl
import json
import os
import pty
import selectors
import signal
import struct
import sys
import termios
import time

receipt_open = True


def emit(kind, **values):
    global receipt_open
    if not receipt_open:
        return
    try:
        print(json.dumps({"type": kind, "at": time.time_ns() // 1_000_000, **values}), flush=True)
    except BrokenPipeError:
        # A vanished parent cannot receive errors; still stop and reap its PTY.
        receipt_open = False


def main():
    config = json.loads(sys.stdin.buffer.readline(262144))
    rows, columns = config["rows"], config["columns"]
    stop_requested = False

    def request_stop(_signum, _frame):
        nonlocal stop_requested
        stop_requested = True

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    pid, master = pty.fork()
    if pid == 0:
        signal.signal(signal.SIGINT, signal.SIG_DFL)
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
        try:
            fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
            os.chdir(config["cwd"])
            os.execvpe(config["bin"], [config["bin"], *config["args"]], os.environ)
        except OSError as error:
            os.write(2, ("PTY child exec failed: errno=" + str(error.errno) + "\n").encode())
            os._exit(127)

    os.set_blocking(master, False)
    os.set_blocking(0, False)
    selector = selectors.DefaultSelector()
    selector.register(master, selectors.EVENT_READ)
    selector.register(0, selectors.EVENT_READ)
    stdin_open, master_open, reaped = True, True, False
    commands, outgoing = bytearray(), bytearray()
    stop_at = None
    killed = False
    signals_sent, errors, probe_observations = [], [], []
    heartbeat_at = 0
    grace = config["stopGraceMs"] / 1000

    def reap():
        nonlocal reaped
        if not reaped:
            waited, status = os.waitpid(pid, os.WNOHANG)
            if waited:
                reaped = True
                emit("child-exit", pid=pid, code=os.waitstatus_to_exitcode(status),
                     signal=signal.Signals(os.WTERMSIG(status)).name if os.WIFSIGNALED(status) else None)

    def group_alive():
        try:
            os.killpg(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            # macOS may report EPERM for a just-exited, unreaped private group.
            # Reap only our exact child, then require a fresh absence check.
            before = reaped
            reap()
            try:
                os.killpg(pid, 0)
                present = True
            except ProcessLookupError:
                present = False
            except PermissionError:
                present = None
            observation = {"pid": pid, "pgid": pid, "code": "EPERM",
                           "childReapedBefore": before, "childReapedAfter": reaped,
                           "groupPresentAfterReap": present}
            probe_observations.append(observation)
            emit("group-probe-observation", **observation)
            return present is not False

    def send_signal(number):
        try:
            # pty.fork created this exact child's private session/process group.
            os.killpg(pid, number)
            name = signal.Signals(number).name
            signals_sent.append(name)
            emit("signal", pid=pid, pgid=pid, signal=name)
        except ProcessLookupError:
            pass
        except OSError as error:
            errors.append("signal_errno_" + str(error.errno))
            emit("error", code="owned_signal_failed", errno=error.errno)

    try:
        emit("started", pid=pid, ppid=os.getpid(), pgid=pid, rows=rows, columns=columns)
        while True:
            now = time.monotonic()
            stop_requested = stop_requested or not receipt_open
            reap()
            alive = group_alive()
            if reaped and not alive:
                if master_open:
                    try:
                        while True:
                            data = os.read(master, 65536)
                            if not data:
                                break
                            emit("data", base64=base64.b64encode(data).decode("ascii"))
                    except OSError as error:
                        if error.errno not in (errno.EIO, errno.EAGAIN):
                            errors.append("read_errno_" + str(error.errno))
                break
            if reaped and alive:
                stop_requested = True
            if stop_requested and stop_at is None:
                stop_at = now
                send_signal(signal.SIGINT)
            if stop_at is not None and now - stop_at >= grace and not killed:
                killed = True
                send_signal(signal.SIGKILL)
            if stop_at is not None and now - stop_at >= grace + 2:
                errors.append("owned_cleanup_deadline")
                break
            if now >= heartbeat_at:
                heartbeat_at = now + 1
                emit("heartbeat", pid=pid, childAlive=not reaped, processGroupAlive=alive)
            for key, mask in selector.select(0.05):
                if key.fd == master:
                    if mask & selectors.EVENT_READ:
                        try:
                            data = os.read(master, 65536)
                        except OSError as error:
                            if error.errno == errno.EAGAIN:
                                continue
                            if error.errno != errno.EIO:
                                errors.append("read_errno_" + str(error.errno))
                            data = b""
                        if data:
                            emit("data", base64=base64.b64encode(data).decode("ascii"))
                        else:
                            selector.unregister(master)
                            master_open = False
                    if mask & selectors.EVENT_WRITE and outgoing and master_open:
                        try:
                            count = os.write(master, outgoing)
                            del outgoing[:count]
                        except BlockingIOError:
                            pass
                        except OSError as error:
                            errors.append("write_errno_" + str(error.errno))
                            stop_requested = True
                    if master_open:
                        selector.modify(master, selectors.EVENT_READ | (selectors.EVENT_WRITE if outgoing else 0))
                elif stdin_open:
                    data = os.read(0, 65536)
                    if not data:
                        selector.unregister(0)
                        stdin_open = False
                        stop_requested = True
                        continue
                    commands.extend(data)
                    if len(commands) > 262144:
                        raise ValueError("PTY control input budget exceeded")
                    while b"\n" in commands:
                        line, _, rest = commands.partition(b"\n")
                        commands = bytearray(rest)
                        command = json.loads(line)
                        if command["type"] == "stop":
                            stop_requested = True
                        elif command["type"] == "input" and not stop_requested and master_open:
                            outgoing.extend(base64.b64decode(command["base64"], validate=True))
                            if len(outgoing) > 131072:
                                raise ValueError("PTY write budget exceeded")
                            selector.modify(master, selectors.EVENT_READ | selectors.EVENT_WRITE)
                        else:
                            emit("error", code="invalid_pty_control")
                            stop_requested = True
    except Exception as error:
        errors.append(type(error).__name__)
        emit("error", code="pty_helper_failure", category=type(error).__name__)
    finally:
        if not reaped:
            send_signal(signal.SIGKILL)
            deadline = time.monotonic() + 2
            while not reaped and time.monotonic() < deadline:
                waited, _ = os.waitpid(pid, os.WNOHANG)
                reaped = bool(waited)
                if not reaped:
                    time.sleep(0.01)
        gone = not group_alive()
        selector.close()
        os.close(master)
        emit("cleanup", pid=pid, childReaped=reaped, processGroupGone=gone,
             signals=signals_sent, errors=errors, probeObservations=probe_observations)
    return 0 if reaped and gone and not errors else 1


if __name__ == "__main__":
    sys.exit(main())
