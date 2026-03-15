#!/bin/bash

# Install bash completion for run.sh script

set -e

COMPLETION_FILE="$HOME/.bash_completion"
RUN_COMPLETION_SCRIPT="$(dirname "$0")/run-completion.bash"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if completion script exists
if [ ! -f "$RUN_COMPLETION_SCRIPT" ]; then
    print_error "Completion script not found: $RUN_COMPLETION_SCRIPT"
    exit 1
fi

# Create or update .bash_completion
if [ -f "$COMPLETION_FILE" ]; then
    # Check if already added
    if grep -q "run-completion.bash" "$COMPLETION_FILE"; then
        print_status "Tab completion already installed"
    else
        print_status "Adding completion to existing .bash_completion..."
        echo "" >> "$COMPLETION_FILE"
        echo "# MST AI Portal run.sh completion" >> "$COMPLETION_FILE"
        echo "source \"$RUN_COMPLETION_SCRIPT\"" >> "$COMPLETION_FILE"
        print_status "Tab completion added to .bash_completion"
    fi
else
    print_status "Creating .bash_completion..."
    echo "# MST AI Portal run.sh completion" > "$COMPLETION_FILE"
    echo "source \"$RUN_COMPLETION_SCRIPT\"" >> "$COMPLETION_FILE"
    print_status "Tab completion installed"
fi

# Also add to .bashrc if .bash_completion is not sourced
BASHRC="$HOME/.bashrc"
if [ -f "$BASHRC" ]; then
    if ! grep -q "\.bash_completion" "$BASHRC"; then
        print_status "Adding .bash_completion sourcing to .bashrc..."
        echo "" >> "$BASHRC"
        echo "# Enable bash completion" >> "$BASHRC"
        echo "if [ -f ~/.bash_completion ]; then" >> "$BASHRC"
        echo "    . ~/.bash_completion" >> "$BASHRC"
        echo "fi" >> "$BASHRC"
    fi
fi

print_status "Installation complete!"
echo ""
print_warning "To enable tab completion immediately, run:"
echo "  source ~/.bash_completion"
echo ""
print_warning "Or restart your terminal session"
echo ""
print_status "Available completions:"
echo "  ./run.sh <TAB>           # Show main commands"
echo "  ./run.sh logs <TAB>      # Show log options"
echo "  ./run.sh docker-compose <TAB>  # Show docker-compose options"
