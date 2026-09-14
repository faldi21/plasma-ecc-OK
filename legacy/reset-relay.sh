#!/bin/bash
# Reset relay state safely

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}           RELAY STATE RESET${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
    echo ""
}

show_usage() {
    print_header
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  status          Show current relay state"
    echo "  reset           Reset relay state (delete relay-state.json)"
    echo "  clean-all       Reset all data (Anvil + relay + backend)"
    echo ""
    echo "Examples:"
    echo "  $0 status       # Check current state"
    echo "  $0 reset        # Reset only relay"
    echo "  $0 clean-all    # Full reset"
    echo ""
}

show_status() {
    print_header
    
    if [ -f "data/relay-state.json" ]; then
        echo "✓ Relay state file exists:"
        echo ""
        cat data/relay-state.json | head -20
        echo ""
    else
        echo -e "${YELLOW}✗ No relay state file found${NC}"
        echo ""
    fi
}

reset_relay() {
    print_header
    
    if [ -f "data/relay-state.json" ]; then
        echo -e "${YELLOW}Deleting relay state...${NC}"
        rm data/relay-state.json
        echo -e "${GREEN}✓ Relay state deleted${NC}"
        echo ""
        echo "Next steps:"
        echo "  1. Restart relay: npm run dev:relay"
        echo "  2. Relay will start from L1_FROM_BLOCK=0"
        echo "  3. New state will be created at: data/relay-state.json"
        echo ""
    else
        echo -e "${YELLOW}No relay state file to delete${NC}"
        echo ""
    fi
}

clean_all() {
    print_header
    
    echo -e "${RED}WARNING: This will delete ALL persistent state!${NC}"
    echo ""
    echo "Files to be deleted:"
    echo "  - data/anvil-state.json (L2 blockchain state)"
    echo "  - data/relay-state.json (relay processed deposits)"
    echo "  - data/plasma-state.json (backend plasma chain state)"
    echo ""
    read -p "Are you sure? (yes/no): " confirm
    
    if [ "$confirm" = "yes" ]; then
        echo ""
        echo -e "${YELLOW}Deleting all state files...${NC}"
        rm -f data/anvil-state.json data/relay-state.json data/plasma-state.json
        echo -e "${GREEN}✓ All state files deleted${NC}"
        echo ""
        echo "Next steps for fresh deployment:"
        echo "  1. Start Anvil fresh: ./anvil.sh start-fresh"
        echo "  2. Start relay: npm run dev:relay"
        echo "  3. Start backend: npm run dev:utxo"
        echo ""
    else
        echo "Cancelled."
        echo ""
    fi
}

# Main
case "${1:-}" in
    status)
        show_status
        ;;
    reset)
        reset_relay
        ;;
    clean-all)
        clean_all
        ;;
    *)
        show_usage
        ;;
esac
