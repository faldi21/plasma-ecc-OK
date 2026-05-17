#!/bin/bash
# ============================================================
#  Anvil State Manager
#  Mengelola state Anvil (L2) dengan persistence
# ============================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/data"
STATE_FILE="$DATA_DIR/anvil-state.json"
ANVIL_PORT=8545
ANVIL_HOST="0.0.0.0"
ANVIL_GAS_LIMIT=300000000

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Ensure data directory exists
mkdir -p "$DATA_DIR"

# Print header
print_header() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}           ANVIL STATE MANAGER (L2)${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Check if anvil is running
is_anvil_running() {
    pgrep -f "anvil.*--port $ANVIL_PORT" > /dev/null 2>&1
}

# Get anvil PID
get_anvil_pid() {
    pgrep -f "anvil.*--port $ANVIL_PORT" 2>/dev/null || echo ""
}

# Start anvil fresh (no state)
start_fresh() {
    print_header
    echo -e "${YELLOW}Starting Anvil fresh (no saved state)...${NC}"

    if is_anvil_running; then
        echo -e "${RED}Anvil is already running on port $ANVIL_PORT${NC}"
        echo "Use: $0 stop   to stop it first"
        exit 1
    fi

    # Remove old state if exists
    if [ -f "$STATE_FILE" ]; then
        echo -e "${YELLOW}Removing old state file...${NC}"
        rm -f "$STATE_FILE"
    fi

    echo -e "${GREEN}Starting Anvil...${NC}"
    anvil --host $ANVIL_HOST --port $ANVIL_PORT --gas-limit $ANVIL_GAS_LIMIT &

    sleep 2

    if is_anvil_running; then
        echo ""
        echo -e "${GREEN}✓ Anvil started successfully${NC}"
        echo -e "  PID: $(get_anvil_pid)"
        echo -e "  RPC: http://localhost:$ANVIL_PORT"
        echo ""
    else
        echo -e "${RED}✗ Failed to start Anvil${NC}"
        exit 1
    fi
}

# Start anvil with saved state
start_with_state() {
    print_header

    if is_anvil_running; then
        echo -e "${RED}Anvil is already running on port $ANVIL_PORT${NC}"
        echo "Use: $0 stop   to stop it first"
        exit 1
    fi

    if [ ! -f "$STATE_FILE" ]; then
        echo -e "${YELLOW}No saved state found at: $STATE_FILE${NC}"
        echo -e "${YELLOW}Starting fresh instead...${NC}"
        echo ""
        anvil --host $ANVIL_HOST --port $ANVIL_PORT --gas-limit $ANVIL_GAS_LIMIT &
    else
        echo -e "${GREEN}Loading state from: $STATE_FILE${NC}"
        echo ""
        anvil --host $ANVIL_HOST --port $ANVIL_PORT --gas-limit $ANVIL_GAS_LIMIT --load-state "$STATE_FILE" &
    fi

    sleep 2

    if is_anvil_running; then
        echo -e "${GREEN}✓ Anvil started successfully${NC}"
        echo -e "  PID: $(get_anvil_pid)"
        echo -e "  RPC: http://localhost:$ANVIL_PORT"
        echo ""
    else
        echo -e "${RED}✗ Failed to start Anvil${NC}"
        exit 1
    fi
}

# Save current anvil state (using cast rpc with proper decompression)
save_state() {
    print_header
    echo -e "${YELLOW}Saving Anvil state...${NC}"

    if ! is_anvil_running; then
        echo -e "${RED}Anvil is not running${NC}"
        exit 1
    fi

    # Use cast rpc to dump state and decompress properly
    # anvil_dumpState returns hex-encoded gzipped data
    echo -e "${YELLOW}Dumping state from Anvil...${NC}"

    RESULT=$(cast rpc anvil_dumpState --rpc-url http://localhost:$ANVIL_PORT 2>/dev/null || echo "")

    if [ -z "$RESULT" ] || [ "$RESULT" = "null" ]; then
        echo -e "${RED}✗ Failed to get state from Anvil${NC}"
        exit 1
    fi

    # Remove leading 0x and convert hex to binary, then decompress
    echo -e "${YELLOW}Decompressing state...${NC}"

    if echo "$RESULT" | sed 's/^0x//' | xxd -r -p | gunzip > "$STATE_FILE" 2>/dev/null; then
        # Get file size
        SIZE=$(ls -lh "$STATE_FILE" | awk '{print $5}')

        echo ""
        echo -e "${GREEN}✓ State saved successfully${NC}"
        echo -e "  File: $STATE_FILE"
        echo -e "  Size: $SIZE"
        echo ""
    else
        echo -e "${RED}✗ Failed to decompress state${NC}"
        exit 1
    fi
}

# Stop anvil (with auto-save)
stop_anvil() {
    print_header

    if ! is_anvil_running; then
        echo -e "${YELLOW}Anvil is not running${NC}"
        exit 0
    fi

    # Auto-save state before stopping
    echo -e "${YELLOW}Saving state before stopping...${NC}"

    RESULT=$(cast rpc anvil_dumpState --rpc-url http://localhost:$ANVIL_PORT 2>/dev/null || echo "")

    if [ -n "$RESULT" ] && [ "$RESULT" != "null" ]; then
        # Remove leading 0x and convert hex to binary, then decompress
        if echo "$RESULT" | sed 's/^0x//' | xxd -r -p | gunzip > "$STATE_FILE" 2>/dev/null; then
            SIZE=$(ls -lh "$STATE_FILE" | awk '{print $5}')
            echo -e "${GREEN}✓ State saved to: $STATE_FILE (Size: $SIZE)${NC}"
        else
            echo -e "${YELLOW}⚠ Could not decompress state${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ Could not save state (anvil may have already stopped)${NC}"
    fi

    echo ""
    echo -e "${YELLOW}Stopping Anvil...${NC}"

    PID=$(get_anvil_pid)
    kill "$PID" 2>/dev/null || true

    sleep 2

    # Force kill if still running
    if is_anvil_running; then
        kill -9 "$(get_anvil_pid)" 2>/dev/null || true
    fi

    echo -e "${GREEN}✓ Anvil stopped${NC}"
    echo ""
}

# Restart anvil (save, stop, start with state)
restart_anvil() {
    print_header
    echo -e "${YELLOW}Restarting Anvil...${NC}"
    echo ""

    if is_anvil_running; then
        # Save and stop
        stop_anvil
    fi

    # Start with saved state
    start_with_state
}

# Show status
show_status() {
    print_header

    echo "Status:"
    if is_anvil_running; then
        echo -e "  Anvil: ${GREEN}Running${NC} (PID: $(get_anvil_pid))"
    else
        echo -e "  Anvil: ${RED}Stopped${NC}"
    fi

    echo ""
    echo "State File:"
    if [ -f "$STATE_FILE" ]; then
        SIZE=$(ls -lh "$STATE_FILE" | awk '{print $5}')
        MODIFIED=$(stat -c %y "$STATE_FILE" 2>/dev/null | cut -d'.' -f1 || stat -f %Sm "$STATE_FILE" 2>/dev/null)
        echo -e "  Path: $STATE_FILE"
        echo -e "  Size: ${GREEN}$SIZE${NC}"
        echo -e "  Modified: $MODIFIED"
    else
        echo -e "  ${YELLOW}No state file found${NC}"
    fi

    echo ""
}

# Delete state file
clean_state() {
    print_header
    echo -e "${YELLOW}Cleaning state...${NC}"

    if [ -f "$STATE_FILE" ]; then
        rm -f "$STATE_FILE"
        echo -e "${GREEN}✓ State file deleted${NC}"
    else
        echo -e "${YELLOW}No state file to delete${NC}"
    fi
    echo ""
}

# Show usage
show_usage() {
    print_header
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  start       Start Anvil with saved state (or fresh if no state)"
    echo "  start-fresh Start Anvil fresh (delete old state)"
    echo "  stop        Save state and stop Anvil"
    echo "  restart     Restart Anvil (save, stop, start with state)"
    echo "  save        Save current Anvil state to file"
    echo "  status      Show Anvil and state file status"
    echo "  clean       Delete state file (for fresh start)"
    echo ""
    echo "Files:"
    echo "  State: $STATE_FILE"
    echo ""
    echo "Examples:"
    echo "  $0 start        # Start with saved state"
    echo "  $0 start-fresh  # Start fresh, delete old state"
    echo "  $0 stop         # Auto-save and stop"
    echo "  $0 restart      # Restart with saved state"
    echo ""
}

# Main
case "${1:-}" in
    start)
        start_with_state
        ;;
    start-fresh)
        start_fresh
        ;;
    stop)
        stop_anvil
        ;;
    restart)
        restart_anvil
        ;;
    save)
        save_state
        ;;
    status)
        show_status
        ;;
    clean)
        clean_state
        ;;
    *)
        show_usage
        ;;
esac
