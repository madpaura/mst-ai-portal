#!/bin/bash

# Bash completion for MST AI Portal run.sh script

_run_completion() {
    local cur prev words cword
    _init_completion || return

    # Main commands
    local commands="start stop restart init ui backend transcode-worker docker-compose status logs help"

    # Log options
    local log_options="backend frontend worker"

    case "${prev}" in
        logs)
            COMPREPLY=($(compgen -W "${log_options}" -- "${cur}"))
            return
            ;;
        docker-compose)
            # Use docker-compose completion if available
            if command -v _docker_compose >/dev/null 2>&1; then
                _docker_compose
            else
                # Basic docker-compose commands
                local dc_commands="up down ps logs build exec start stop restart"
                COMPREPLY=($(compgen -W "${dc_commands}" -- "${cur}"))
            fi
            return
            ;;
        help|--help|-h)
            return
            ;;
    esac

    # Complete main commands
    if [[ ${cword} -eq 1 ]]; then
        COMPREPLY=($(compgen -W "${commands}" -- "${cur}"))
        return
    fi

    # Handle specific command completions
    case "${words[1]}" in
        start|stop|restart|init|ui|backend|transcode-worker|status)
            # These commands don't take additional arguments
            return
            ;;
        logs)
            if [[ ${cword} -eq 2 ]]; then
                COMPREPLY=($(compgen -W "${log_options}" -- "${cur}"))
            fi
            return
            ;;
        docker-compose)
            # Let docker-completion handle the rest
            if command -v _docker_compose >/dev/null 2>&1; then
                # Remove 'run.sh' and 'docker-compose' from words and adjust cword
                local docker_words=("${words[@]:2}")
                local docker_cword=$((cword - 2))
                _docker_compose "${docker_words[@]}" ${docker_cword}
            fi
            return
            ;;
    esac
}

# Register the completion function
complete -F _run_completion ./run.sh
complete -F _run_completion run.sh
