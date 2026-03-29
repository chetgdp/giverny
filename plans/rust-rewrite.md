# Rust Rewrite

Rewrite after TS is feature-complete. The TS version is the prototype, the Rust version is the command line product. 

Motivation: local inference backends that we want to implement eventually, make the 10ms Bun overhead matter. Across thousands of calls, it adds up. Memory safety matters for a program between an LLM and `rm -rf`, and a single static binary with zero runtime dependencies is the correct form factor for this type of composable agentic shell program. 

The Architecture maps: Various `Backend` interface become a trait(s), NDJSON parsing becomes serde (which is fast af), process control becomes nix, HTTP server becomes axum or something else. ~3,000 lines of TS becomes ~4,000-5,000 lines of Rust. 

Until rewrite avoid feature creep. Do not add: built-in inference, markdown rendering, plugin systems, etc. Giverny is a bridge, not an app.
