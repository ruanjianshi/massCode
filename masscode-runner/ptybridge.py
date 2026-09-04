#!/usr/bin/env python3
"""码境 CodeScope 底部终端桥：为 shell 分配真实伪终端(PTY)，在 stdin/stdout 间双向转发。
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
import json

shell = os.environ.get('SHELL', '/bin/bash')
command = sys.argv[2:] if len(sys.argv) > 2 and sys.argv[1] == '--' else [shell]
os.environ['TERM'] = 'xterm-256color'

pid, fd = pty.fork()
if pid == 0:
    os.execvp(command[0], command)

# 设置伪终端窗口尺寸，让全屏程序/提示符正常渲染
try:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 120, 0, 0))
except Exception:
    pass

# Node 通过额外的 fd 3 发送窗口行列数，和用户键盘输入分离，避免控制数据进入 shell。
control_fd = 3
control_buffer = b''
try:
    os.fstat(control_fd)
except OSError:
    control_fd = None

def apply_window_size(message):
    try:
        size = json.loads(message.decode('utf-8'))
        rows = max(5, min(500, int(size.get('rows', 24))))
        cols = max(20, min(1000, int(size.get('cols', 120))))
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        os.kill(pid, signal.SIGWINCH)
    except (ValueError, TypeError, OSError, json.JSONDecodeError):
        pass

try:
    while True:
        readers = [sys.stdin, fd] + ([control_fd] if control_fd is not None else [])
        r, _, _ = select.select(readers, [], [])
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
        if control_fd is not None and control_fd in r:
            try:
                chunk = os.read(control_fd, 4096)
            except OSError:
                chunk = b''
            if not chunk:
                control_fd = None
            else:
                control_buffer += chunk
                while b'\n' in control_buffer:
                    line, control_buffer = control_buffer.split(b'\n', 1)
                    if line:
                        apply_window_size(line)
except (OSError, KeyboardInterrupt):
    pass
finally:
    try:
        os.kill(pid, signal.SIGKILL)
    except Exception:
        pass
    os._exit(0)
