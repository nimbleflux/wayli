FROM node:25-bookworm

# Build arguments for versions
ARG TZ=UTC
ARG CLAUDE_CODE_VERSION=latest
ARG GIT_DELTA_VERSION=0.18.2
ARG ZSH_VERSION=master

# Set timezone
ENV TZ=${TZ}
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Install additional tools
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    git \
    postgresql-client \
    curl \
    vim \
    nano \
    zsh \
    fzf \
    jq \
    sudo \
    gnupg2 \
    dnsutils \
    ca-certificates \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install Git Delta for better diffs
RUN curl -L "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_$(dpkg --print-architecture).deb" -o /tmp/git-delta.deb \
    && dpkg -i /tmp/git-delta.deb \
    && rm /tmp/git-delta.deb

# Install Deno (required for edge functions bundling)
RUN ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then DENO_ARCH="x86_64-unknown-linux-gnu"; \
    elif [ "$ARCH" = "arm64" ]; then DENO_ARCH="aarch64-unknown-linux-gnu"; \
    else echo "Unsupported architecture: $ARCH" && exit 1; fi \
    && DENO_VERSION=$(curl -s https://api.github.com/repos/denoland/deno/releases/latest | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/') \
    && curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${DENO_ARCH}.zip" -o /tmp/deno.zip \
    && unzip -q /tmp/deno.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/deno \
    && rm /tmp/deno.zip \
    && deno --version

# Install pnpm globally
RUN npm install -g pnpm

# Install Fluxbase CLI for resource synchronization
ARG FLUXBASE_CLI_VERSION=v2026.1.12-rc.4
RUN curl -fsSL https://raw.githubusercontent.com/fluxbase-eu/fluxbase/main/install-cli.sh | bash -s -- ${FLUXBASE_CLI_VERSION:-latest}

# Set up non-root user
ARG USERNAME=node
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Create command history directory
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
    && mkdir /commandhistory \
    && touch /commandhistory/.bash_history \
    && chown -R $USERNAME:$USERNAME /commandhistory \
    && echo "$SNIPPET" >> "/home/$USERNAME/.bashrc"

# Configure git to trust the workspace directory
RUN git config --system --add safe.directory /workspace

# Install zsh-in-docker with powerline10k theme
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/${ZSH_VERSION}/zsh-in-docker.sh)" -- \
    -t https://github.com/romkatv/powerlevel10k \
    -p git \
    -p fzf \
    -p https://github.com/zsh-users/zsh-autosuggestions \
    -p https://github.com/zsh-users/zsh-syntax-highlighting

# Configure default editor and shell
ENV EDITOR=nano
ENV SHELL=/bin/zsh

# Set default shell to zsh for node user
RUN chsh -s /bin/zsh $USERNAME

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Create Claude config directory
RUN mkdir -p /home/$USERNAME/.claude && chown -R $USERNAME:$USERNAME /home/$USERNAME/.claude

# Set up npm global directory
RUN mkdir -p /usr/local/share/npm-global \
    && chown -R $USERNAME:$USERNAME /usr/local/share/npm-global \
    && npm config set prefix /usr/local/share/npm-global

# Add npm global bin to PATH
ENV PATH=/usr/local/share/npm-global/bin:$PATH

# Allow node user to run firewall script with sudo
RUN echo "$USERNAME ALL=(ALL) NOPASSWD: /usr/local/bin/init-firewall.sh" >> /etc/sudoers

USER $USERNAME

# Set up fzf keybindings and completion for bash and zsh
RUN echo '[ -f /usr/share/doc/fzf/examples/key-bindings.bash ] && source /usr/share/doc/fzf/examples/key-bindings.bash' >> ~/.bashrc \
    && echo '[ -f /usr/share/doc/fzf/examples/completion.bash ] && source /usr/share/doc/fzf/examples/completion.bash' >> ~/.bashrc \
    && echo '[ -f /usr/share/doc/fzf/examples/key-bindings.zsh ] && source /usr/share/doc/fzf/examples/key-bindings.zsh' >> ~/.zshrc \
    && echo '[ -f /usr/share/doc/fzf/examples/completion.zsh ] && source /usr/share/doc/fzf/examples/completion.zsh' >> ~/.zshrc

# Disable git status in powerline10k for performance
RUN echo 'POWERLEVEL9K_DISABLE_GITSTATUS=true' >> ~/.zshrc

# Automatically unset NODE_OPTIONS to avoid VS Code debugger conflicts
RUN echo 'unset NODE_OPTIONS' >> ~/.bashrc \
    && echo 'unset NODE_OPTIONS' >> ~/.zshrc

# Set DEVCONTAINER environment variable
ENV DEVCONTAINER=true

WORKDIR /workspace

# Override the node image's entrypoint to work with devcontainers
ENTRYPOINT []
CMD ["/bin/bash"]
