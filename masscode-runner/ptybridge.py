#!/usr/bin/env python3
"""masscode-runner 底部终端桥：为 shell 分配真实伪终端(PTY)，在 stdin/stdout 间双向转发。
由 server.js 以 `python3 -u ptybridge.py` 启动；macOS/Linux 均自带 python3。
"""
import pty
import os
import sys
import select
import signal
import fcntl
import termios
import struct

shell = os.environ.get('SHELL', '/bin/bash')
os.environ['TERM'] = 'xterm-256color'

pid, fd = pty.fork()
if pid == 0:
    os.execvp(shell, [shell])

# 设置伪终端窗口尺寸，让全屏程序/提示符正常渲染
try:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 120, 0, 0))
except Exception:
    pass

try:
    while True:
        r, _, _ = select.select([sys.stdin, fd], [], [])
        if sys.stdin in r:
            try:
                data = os.read(sys.stdin.fileno(), 1024)
            except OSError:
                break
            if not data:
                break
            os.write(fd, data)
        if fd in r:
            try:
                data = os.read(fd, 1024)
            except OSError:
                break
            if not data:
                break
            os.write(sys.stdout.buffer.fileno(), data)
            sys.stdout.buffer.flush()
except (OSError, KeyboardInterrupt):
    pass
finally:
    try:
        os.kill(pid, signal.SIGKILL)
    except Exception:
        pass
    os._exit(0)
