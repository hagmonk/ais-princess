#!/usr/bin/env python3
"""
Tmux runner for ais-princess services.

Manages web server, decoder, and AIS capture in tmux panes with restart capability.

Layout (horizontal splits):
  ┌─────────────────┐
  │    web (0)      │
  ├─────────────────┤
  │   decoder (1)   │
  ├─────────────────┤
  │   capture (2)   │
  └─────────────────┘
"""

import argparse
import sys
from pathlib import Path

import libtmux


SESSION_NAME = "ais-princess"
PANE_WEB = "web"
PANE_DECODER = "decoder"
PANE_CAPTURE = "capture"

EXPECTED_PANES = 3

# Default commands
DEFAULT_WEB_CMD = "uv run web/main.py --db db/ais-data.db"
DEFAULT_DECODER_CMD = "uv run db/decoder.py --db db/ais-data.db"
DEFAULT_CAPTURE_CMD = "uv run capture/ais-catcher.py --tuner 49.9 --ppm -1 --rtlagc --db db/ais-data.db"

# Pane indices
PANE_INDEX = {
    PANE_WEB: 0,
    PANE_DECODER: 1,
    PANE_CAPTURE: 2,
}

DEFAULT_CMDS = {
    PANE_WEB: DEFAULT_WEB_CMD,
    PANE_DECODER: DEFAULT_DECODER_CMD,
    PANE_CAPTURE: DEFAULT_CAPTURE_CMD,
}


def get_or_create_session(server: libtmux.Server) -> libtmux.Session:
    """Get existing session or create new one."""
    try:
        return server.sessions.get(session_name=SESSION_NAME)
    except Exception:
        pass

    # Create new session
    session = server.new_session(session_name=SESSION_NAME)
    return session


def setup_panes(session: libtmux.Session) -> tuple[libtmux.Pane, libtmux.Pane, libtmux.Pane]:
    """Set up three panes in horizontal splits (top/middle/bottom)."""
    window = session.active_window

    # Rename the window
    window.rename_window("services")

    # Get the first pane (web - top)
    web_pane = window.active_pane

    # Split for decoder pane (middle)
    decoder_pane = window.split(direction=libtmux.constants.PaneDirection.Below)

    # Split decoder pane for capture (bottom)
    capture_pane = window.split(direction=libtmux.constants.PaneDirection.Below)

    return web_pane, decoder_pane, capture_pane


def run_in_pane(pane: libtmux.Pane, cmd: str, name: str):
    """Run a command in a pane, killing any existing process first."""
    # Send Ctrl-C to stop any running process
    pane.send_keys("C-c", literal=False)

    # Small delay to let process terminate
    import time
    time.sleep(0.2)

    # Clear the terminal
    pane.send_keys("clear", enter=True)

    # Set pane title for identification
    pane.send_keys(f"printf '\\033]2;{name}\\033\\\\'", enter=True)

    # Run the command
    pane.send_keys(cmd, enter=True)


def start_services(project_dir: Path, web_cmd: str = None, decoder_cmd: str = None, capture_cmd: str = None, force: bool = False):
    """Start all three services in tmux panes."""
    server = libtmux.Server()
    session = get_or_create_session(server)

    # Check if we already have panes running
    windows = session.windows
    if len(windows) == 1 and len(windows[0].panes) >= 1:
        num_panes = len(windows[0].panes)
        if num_panes != EXPECTED_PANES:
            if force:
                print(f"Killing existing session with {num_panes} panes...")
                session.kill()
                session = server.new_session(session_name=SESSION_NAME)
            else:
                print(f"Session '{SESSION_NAME}' exists with {num_panes} panes (expected {EXPECTED_PANES}).")
                print(f"Use --force to recreate, or --stop first.")
                return
        else:
            print(f"Session '{SESSION_NAME}' already has {EXPECTED_PANES} panes.")
            print(f"Use --restart-web, --restart-decoder, or --restart-capture to restart individual services.")
            return

    # Set up fresh panes
    web_pane, decoder_pane, capture_pane = setup_panes(session)

    # Change to project directory in all panes
    for pane in [web_pane, decoder_pane, capture_pane]:
        pane.send_keys(f"cd {project_dir}", enter=True)

    # Start services
    run_in_pane(web_pane, web_cmd or DEFAULT_WEB_CMD, PANE_WEB)
    run_in_pane(decoder_pane, decoder_cmd or DEFAULT_DECODER_CMD, PANE_DECODER)
    run_in_pane(capture_pane, capture_cmd or DEFAULT_CAPTURE_CMD, PANE_CAPTURE)

    print(f"Started services in tmux session '{SESSION_NAME}'")
    print(f"  Pane 0 (web):     {web_cmd or DEFAULT_WEB_CMD}")
    print(f"  Pane 1 (decoder): {decoder_cmd or DEFAULT_DECODER_CMD}")
    print(f"  Pane 2 (capture): {capture_cmd or DEFAULT_CAPTURE_CMD}")
    print(f"\nAttach with: tmux attach -t {SESSION_NAME}")


def restart_pane(pane_name: str, cmd: str = None, project_dir: Path = None):
    """Restart a specific pane."""
    server = libtmux.Server()

    try:
        session = server.sessions.get(session_name=SESSION_NAME)
    except Exception:
        print(f"Error: Session '{SESSION_NAME}' not found. Run without arguments to start.")
        sys.exit(1)

    window = session.windows[0]
    panes = window.panes

    if len(panes) != EXPECTED_PANES:
        print(f"Error: Expected {EXPECTED_PANES} panes, found {len(panes)}.")
        print(f"Run 'uv run ais-tmux --force' to recreate session.")
        sys.exit(1)

    pane_idx = PANE_INDEX.get(pane_name)
    if pane_idx is None:
        print(f"Error: Unknown pane '{pane_name}'")
        sys.exit(1)

    pane = panes[pane_idx]
    default_cmd = DEFAULT_CMDS[pane_name]

    # Change to project dir if provided
    if project_dir:
        pane.send_keys(f"cd {project_dir}", enter=True)

    run_in_pane(pane, cmd or default_cmd, pane_name)
    print(f"Restarted {pane_name} pane with: {cmd or default_cmd}")


def stop_services():
    """Stop the tmux session."""
    server = libtmux.Server()

    try:
        session = server.sessions.get(session_name=SESSION_NAME)
        session.kill()
        print(f"Stopped session '{SESSION_NAME}'")
    except Exception:
        print(f"Session '{SESSION_NAME}' not found or already stopped.")


def status():
    """Show status of the tmux session."""
    server = libtmux.Server()

    try:
        session = server.sessions.get(session_name=SESSION_NAME)
    except Exception:
        print(f"Session '{SESSION_NAME}' is not running.")
        print(f"\nStart with: uv run ais-tmux")
        return

    print(f"Session '{SESSION_NAME}' is running.")
    print(f"\nPanes:")
    for window in session.windows:
        for i, pane in enumerate(window.panes):
            cmd = pane.pane_current_command
            name = list(PANE_INDEX.keys())[i] if i < len(PANE_INDEX) else "unknown"
            print(f"  [{i}] {name}: {cmd}")

    print(f"\nCommands:")
    print(f"  Attach:          tmux attach -t {SESSION_NAME}")
    print(f"  Restart all:     uv run ais-tmux --restart-all")
    print(f"  Restart web:     uv run ais-tmux --restart-web")
    print(f"  Restart decoder: uv run ais-tmux --restart-decoder")
    print(f"  Restart capture: uv run ais-tmux --restart-capture")
    print(f"  Stop all:        uv run ais-tmux --stop")


def main():
    parser = argparse.ArgumentParser(
        description="Manage ais-princess services in tmux",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Layout:
  ┌─────────────────┐
  │    web (0)      │  <- Web server (main.py)
  ├─────────────────┤
  │   decoder (1)   │  <- Message decoder (decoder.py)
  ├─────────────────┤
  │   capture (2)   │  <- AIS capture (ais-catcher.py)
  └─────────────────┘

Examples:
  ais-tmux                    Start all services
  ais-tmux --force            Recreate session (kills existing)
  ais-tmux --status           Show current status
  ais-tmux --restart-all      Restart all services
  ais-tmux --restart-web      Restart web server
  ais-tmux --restart-decoder  Restart decoder
  ais-tmux --restart-capture  Restart AIS capture
  ais-tmux --stop             Stop all services
        """
    )

    parser.add_argument(
        "--restart-web",
        action="store_true",
        help="Restart the web server pane"
    )
    parser.add_argument(
        "--restart-decoder",
        action="store_true",
        help="Restart the decoder pane"
    )
    parser.add_argument(
        "--restart-capture",
        action="store_true",
        help="Restart the AIS capture pane"
    )
    parser.add_argument(
        "--restart-all",
        action="store_true",
        help="Restart all services"
    )
    parser.add_argument(
        "--stop",
        action="store_true",
        help="Stop the tmux session"
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show status of the tmux session"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force recreate session (kills existing)"
    )
    parser.add_argument(
        "--web-cmd",
        type=str,
        default=None,
        help=f"Custom web server command"
    )
    parser.add_argument(
        "--decoder-cmd",
        type=str,
        default=None,
        help=f"Custom decoder command"
    )
    parser.add_argument(
        "--capture-cmd",
        type=str,
        default=None,
        help=f"Custom capture command"
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path(__file__).parent.parent,
        help="Project directory (default: auto-detected)"
    )

    args = parser.parse_args()

    # Resolve project directory
    project_dir = args.project_dir.resolve()

    if args.status:
        status()
    elif args.stop:
        stop_services()
    elif args.restart_all:
        restart_pane(PANE_WEB, args.web_cmd, project_dir)
        restart_pane(PANE_DECODER, args.decoder_cmd, project_dir)
        restart_pane(PANE_CAPTURE, args.capture_cmd, project_dir)
        print("Restarted all services.")
    elif args.restart_web:
        restart_pane(PANE_WEB, args.web_cmd, project_dir)
    elif args.restart_decoder:
        restart_pane(PANE_DECODER, args.decoder_cmd, project_dir)
    elif args.restart_capture:
        restart_pane(PANE_CAPTURE, args.capture_cmd, project_dir)
    else:
        start_services(project_dir, args.web_cmd, args.decoder_cmd, args.capture_cmd, args.force)


if __name__ == "__main__":
    main()
