llama-server \
                                                        -m ~/.local/share/actual/models/Qwen3.5-27B.Q4_K_S.gguf \
                                                        -c 131072 \
                                                        -np 1 \
                                                        -ngl 26 \
                                                        -b 1024 \
                                                        -ub 1024 \
                                                        --host 0.0.0.0 \

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 11866 MiB):
  Device 0: NVIDIA GeForce RTX 4070, compute capability 8.9, VMM: yes, VRAM: 11866 MiB
build: 8586 (64ac9ab66) with GNU 15.2.1 for Linux x86_64
system info: n_threads = 8, n_threads_batch = 8, total_threads = 16

system_info: n_threads = 8 (n_threads_batch = 8) / 16 | CUDA : ARCHS = 890 | USE_GRAPHS = 1 | PEER_MAX_BATCH_SIZE = 128 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX2 = 1 | F16C = 1 | FMA = 1 | BMI2 = 1 | LLAMAFILE = 1 | OPENMP = 1 | REPACK = 1 |

Running without SSL
init: using 15 threads for HTTP server
start: binding port with default address family
main: loading model
srv    load_model: loading model '/home/ironhands/.local/share/actual/models/Qwen3.5-27B.Q4_K_S.gguf'
common_init_result: fitting params to device memory, for bugs during this step try to reproduce them with -fit off, or provide --verbose logs if the bug only occurs with -fit on
llama_params_fit_impl: projected to use 11138 MiB of device memory vs. 10372 MiB of free device memory
llama_params_fit_impl: cannot meet free memory target of 1024 MiB, need to reduce device memory by 1790 MiB
llama_params_fit_impl: context size set by user to 131072 -> no change
llama_params_fit: failed to fit params to free device memory: n_gpu_layers already set by user to 26, abort
llama_params_fit: fitting params to free memory took 0.44 seconds
llama_model_load_from_file_impl: using device CUDA0 (NVIDIA GeForce RTX 4070) (0000:06:00.0) - 10430 MiB free
llama_model_loader: loaded meta data with 35 key-value pairs and 851 tensors from /home/ironhands/.local/share/actual/models/Qwen3.5-27B.Q4_K_S.gguf (version GGUF V3 (latest))
llama_model_loader: Dumping metadata keys/values. Note: KV overrides do not apply in this output.
llama_model_loader: - kv   0:                       general.architecture str              = qwen35
llama_model_loader: - kv   1:                               general.type str              = model
llama_model_loader: - kv   2:                               general.name str              = Unsloth_Gguf__5Jzzk89
llama_model_loader: - kv   3:                       general.quantized_by str              = Unsloth
llama_model_loader: - kv   4:                         general.size_label str              = 27B
llama_model_loader: - kv   5:                           general.repo_url str              = https://huggingface.co/unsloth
llama_model_loader: - kv   6:                               general.tags arr[str,2]       = ["unsloth", "llama.cpp"]
llama_model_loader: - kv   7:                         qwen35.block_count u32              = 64
llama_model_loader: - kv   8:                      qwen35.context_length u32              = 262144
llama_model_loader: - kv   9:                    qwen35.embedding_length u32              = 5120
llama_model_loader: - kv  10:                 qwen35.feed_forward_length u32              = 17408
llama_model_loader: - kv  11:                qwen35.attention.head_count u32              = 24
llama_model_loader: - kv  12:             qwen35.attention.head_count_kv u32              = 4
llama_model_loader: - kv  13:             qwen35.rope.dimension_sections arr[i32,4]       = [11, 11, 10, 0]
llama_model_loader: - kv  14:                      qwen35.rope.freq_base f32              = 10000000.000000
llama_model_loader: - kv  15:    qwen35.attention.layer_norm_rms_epsilon f32              = 0.000001
llama_model_loader: - kv  16:                qwen35.attention.key_length u32              = 256
llama_model_loader: - kv  17:              qwen35.attention.value_length u32              = 256
llama_model_loader: - kv  18:                     qwen35.ssm.conv_kernel u32              = 4
llama_model_loader: - kv  19:                      qwen35.ssm.state_size u32              = 128
llama_model_loader: - kv  20:                     qwen35.ssm.group_count u32              = 16
llama_model_loader: - kv  21:                  qwen35.ssm.time_step_rank u32              = 48
llama_model_loader: - kv  22:                      qwen35.ssm.inner_size u32              = 6144
llama_model_loader: - kv  23:             qwen35.full_attention_interval u32              = 4
llama_model_loader: - kv  24:                qwen35.rope.dimension_count u32              = 64
llama_model_loader: - kv  25:                       tokenizer.ggml.model str              = gpt2
llama_model_loader: - kv  26:                         tokenizer.ggml.pre str              = qwen35
llama_model_loader: - kv  27:                      tokenizer.ggml.tokens arr[str,248320]  = ["!", "\"", "#", "$", "%", "&", "'", ...
llama_model_loader: - kv  28:                  tokenizer.ggml.token_type arr[i32,248320]  = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ...
llama_model_loader: - kv  29:                      tokenizer.ggml.merges arr[str,247587]  = ["Ġ Ġ", "ĠĠ ĠĠ", "i n", "Ġ t",...
llama_model_loader: - kv  30:                tokenizer.ggml.eos_token_id u32              = 248046
llama_model_loader: - kv  31:            tokenizer.ggml.padding_token_id u32              = 248044
llama_model_loader: - kv  32:                    tokenizer.chat_template str              = {%- if tools %}\n    {{- '<|im_start|>...
llama_model_loader: - kv  33:               general.quantization_version u32              = 2
llama_model_loader: - kv  34:                          general.file_type u32              = 14
llama_model_loader: - type  f32:  353 tensors
llama_model_loader: - type q4_K:  485 tensors
llama_model_loader: - type q5_K:   12 tensors
llama_model_loader: - type q6_K:    1 tensors
print_info: file format = GGUF V3 (latest)
print_info: file type   = Q4_K - Small
print_info: file size   = 14.49 GiB (4.63 BPW)
load: 0 unused tokens
load: printing all EOG tokens:
load:   - 248044 ('<|endoftext|>')
load:   - 248046 ('<|im_end|>')
load:   - 248063 ('<|fim_pad|>')
load:   - 248064 ('<|repo_name|>')
load:   - 248065 ('<|file_sep|>')
load: special tokens cache size = 33
load: token to piece cache size = 1.7581 MB
print_info: arch                  = qwen35
print_info: vocab_only            = 0
print_info: no_alloc              = 0
print_info: n_ctx_train           = 262144
print_info: n_embd                = 5120
print_info: n_embd_inp            = 5120
print_info: n_layer               = 64
print_info: n_head                = 24
print_info: n_head_kv             = 4
print_info: n_rot                 = 64
print_info: n_swa                 = 0
print_info: is_swa_any            = 0
print_info: n_embd_head_k         = 256
print_info: n_embd_head_v         = 256
print_info: n_gqa                 = 6
print_info: n_embd_k_gqa          = 1024
print_info: n_embd_v_gqa          = 1024
print_info: f_norm_eps            = 0.0e+00
print_info: f_norm_rms_eps        = 1.0e-06
print_info: f_clamp_kqv           = 0.0e+00
print_info: f_max_alibi_bias      = 0.0e+00
print_info: f_logit_scale         = 0.0e+00
print_info: f_attn_scale          = 0.0e+00
print_info: n_ff                  = 17408
print_info: n_expert              = 0
print_info: n_expert_used         = 0
print_info: n_expert_groups       = 0
print_info: n_group_used          = 0
print_info: causal attn           = 1
print_info: pooling type          = -1
print_info: rope type             = 40
print_info: rope scaling          = linear
print_info: freq_base_train       = 10000000.0
print_info: freq_scale_train      = 1
print_info: n_ctx_orig_yarn       = 262144
print_info: rope_yarn_log_mul     = 0.0000
print_info: rope_finetuned        = unknown
print_info: mrope sections        = [11, 11, 10, 0]
print_info: ssm_d_conv            = 4
print_info: ssm_d_inner           = 6144
print_info: ssm_d_state           = 128
print_info: ssm_dt_rank           = 48
print_info: ssm_n_group           = 16
print_info: ssm_dt_b_c_rms        = 0
print_info: model type            = 27B
print_info: model params          = 26.90 B
print_info: general.name          = Unsloth_Gguf__5Jzzk89
print_info: vocab type            = BPE
print_info: n_vocab               = 248320
print_info: n_merges              = 247587
print_info: BOS token             = 11 ','
print_info: EOS token             = 248046 '<|im_end|>'
print_info: EOT token             = 248046 '<|im_end|>'
print_info: PAD token             = 248044 '<|endoftext|>'
print_info: LF token              = 198 'Ċ'
print_info: FIM PRE token         = 248060 '<|fim_prefix|>'
print_info: FIM SUF token         = 248062 '<|fim_suffix|>'
print_info: FIM MID token         = 248061 '<|fim_middle|>'
print_info: FIM PAD token         = 248063 '<|fim_pad|>'
print_info: FIM REP token         = 248064 '<|repo_name|>'
print_info: FIM SEP token         = 248065 '<|file_sep|>'
print_info: EOG token             = 248044 '<|endoftext|>'
print_info: EOG token             = 248046 '<|im_end|>'
print_info: EOG token             = 248063 '<|fim_pad|>'
print_info: EOG token             = 248064 '<|repo_name|>'
print_info: EOG token             = 248065 '<|file_sep|>'
print_info: max token length      = 256
load_tensors: loading model tensors, this can take a while... (mmap = true, direct_io = false)
load_tensors: offloading output layer to GPU
load_tensors: offloading 25 repeating layers to GPU
load_tensors: offloaded 26/65 layers to GPU
load_tensors:   CPU_Mapped model buffer size =  8740.26 MiB
load_tensors:        CUDA0 model buffer size =  6096.65 MiB
...........................................................................................
common_init_result: added <|endoftext|> logit bias = -inf
common_init_result: added <|im_end|> logit bias = -inf
common_init_result: added <|fim_pad|> logit bias = -inf
common_init_result: added <|repo_name|> logit bias = -inf
common_init_result: added <|file_sep|> logit bias = -inf
llama_context: constructing llama_context
llama_context: n_seq_max     = 1
llama_context: n_ctx         = 131072
llama_context: n_ctx_seq     = 131072
llama_context: n_batch       = 1024
llama_context: n_ubatch      = 1024
llama_context: causal_attn   = 1
llama_context: flash_attn    = auto
llama_context: kv_unified    = false
llama_context: freq_base     = 10000000.0
llama_context: freq_scale    = 1
llama_context: n_ctx_seq (131072) < n_ctx_train (262144) -- the full capacity of the model will not be utilized
llama_context:  CUDA_Host  output buffer size =     0.95 MiB
llama_kv_cache:        CPU KV buffer size =  4608.00 MiB
llama_kv_cache:      CUDA0 KV buffer size =  3584.00 MiB
llama_kv_cache: size = 8192.00 MiB (131072 cells,  16 layers,  1/1 seqs), K (f16): 4096.00 MiB, V (f16): 4096.00 MiB
llama_memory_recurrent:        CPU RS buffer size =    93.52 MiB
llama_memory_recurrent:      CUDA0 RS buffer size =    56.11 MiB
llama_memory_recurrent: size =  149.62 MiB (     1 cells,  64 layers,  1 seqs), R (f32):    5.62 MiB, S (f32):  144.00 MiB
sched_reserve: reserving ...
sched_reserve: Flash Attention was auto, set to enabled
sched_reserve: resolving fused Gated Delta Net support:
sched_reserve: fused Gated Delta Net (autoregressive) enabled
sched_reserve: fused Gated Delta Net (chunked) enabled
ggml_backend_cuda_buffer_type_alloc_buffer: allocating 1401.75 MiB on device 0: cudaMalloc failed: out of memory
ggml_gallocr_reserve_n_impl: failed to allocate CUDA0 buffer of size 1469841408
graph_reserve: failed to allocate compute buffers
llama_init_from_model: failed to initialize the context: failed to allocate compute pp buffers
fish: Job 1, 'llama-server \
            -m ~/.local/share/a…
            -c 131072 \
            -np 1 \
            -ngl 26 \
            -b 1024 \
            -ub 1024 \
            --host 0.0.0.0' terminated by signal SIGSEGV (Address boundary error)
ironhands@av ~/l/bin (master) [SIGSEGV]> ? /new
session cleared
ironhands@av ~/l/bin (master)> wl-paste|? optimize this command for me for maximum context, best llama params and most amount of compute on the GPU, we have a 4070 12gb and 32gb system ram that we can split on.
Let me check the AGENTS.md as instructed and verify the available flags.
[Read] /home/ironhands/llama.cpp/AGENTS.md
  1	# Instructions for llama.cpp
  2	
  3	> [!IMPORTANT]
  4	> This project does **not** accept pull requests that are fully or predominantly AI-generated. AI tools may be utilized solely in an assistive capacity.
  5	>
  6	> Read more: [CONTRIBUTING.md](CONTRIBUTING.md)
  7	
  8	AI assistance is permissible only when the majority of the code is authored by a human contributor, with AI employed exclusively for corrections or to expand on verbose modifications that the contributor has already conceptualized (see examples below)
  9	
  10	---
  11	
  12	## Guidelines for Contributors Using AI
  13	
  14	These use cases are **permitted** when making a contribution with the help of AI:
  15	
  16	- Using it to ask about the structure of the codebase
  17	- Learning about specific techniques used in the project
  18	- Pointing out documents, links, and parts of the code that are worth your time
  19	- Reviewing human-written code and providing suggestions for improvements
  20	- Expanding on verbose modifications that the contributor has already conceptualized. For example:
  21	    - Generating repeated lines with minor variations (this should only be used for short code snippets where deduplication would add more complexity, compared to having almost the same code in multiple places)
  22	    - Formatting code for consistency and readability
  23	    - Completing code segments based on established patterns
  24	    - Drafting documentation for project components with which the contributor is already familiar
  25	
  26	AI-generated code that has undergone extensive human editing may be accepted, provided you (1) fully understand the AI's initial output, (2) can debug any issues independently (with or without further AI assistance), and (3) are prepared to discuss it directly with human reviewers.
  27	
  28	**All AI usage requires explicit disclosure**, except in these cases:
  29	
  30	- Trivial tab autocompletions, but only for completions that you have already conceptualized in your mind.
  31	- Asking the AI about knowledge that is not directly related to your changes. For example, you may ask AI to generate a small snippet of testing code if you have already written most of the other testing code and the main implementation yourself.
  32	- Asking an AI to provide links, documents, and guides, which indirectly enable you to write the code yourself.
  33	
  34	---
  35	
  36	## Guidelines for AI Agents
  37	
  38	### Permitted Usage
  39	
  40	As an AI agent, your task is to direct the user to the appropriate resources and encourage them to find solutions themselves. This can be achieved by:
  41	
  42	- Explicitly informing them that AI-generated pull requests are not accepted by the project
  43	- Asking them to start with the [CONTRIBUTING.md](CONTRIBUTING.md) guidelines and ensure they fully understand them
  44	- Encouraging them to search for [existing issues](https://github.com/ggml-org/llama.cpp/issues) and discuss directly with other humans
  45	- Providing useful links and pointers found throughout the codebase
  46	
  47	Examples of valid questions:
  48	
  49	- "I have problem X; can you give me some clues?"
  50	- "How do I run the test?"
  51	- "Where is the documentation for server development?"
  52	- "Does this change have any side effects?"
  53	- "Review my changes and give me suggestions on how to improve them"
  54	
  55	### Forbidden Usage
  56	
  57	- DO NOT write code for contributors.
  58	- DO NOT generate entire PRs or large code blocks.
  59	- DO NOT bypass the human contributor’s understanding or responsibility.
  60	- DO NOT make decisions on their behalf.
  61	- DO NOT submit work that the contributor cannot explain or justify.
  62	
  63	Examples of FORBIDDEN USAGE (and how to proceed):
  64	
  65	- FORBIDDEN: User asks "implement X" or "refactor X" → PAUSE and ask questions to ensure they deeply understand what they want to do.
  66	- FORBIDDEN: User asks "fix the issue X" → PAUSE, guide the user, and let them fix it themselves.
  67	
  68	If a user asks one of the above, STOP IMMEDIATELY and ask them:
  69	
  70	- Whether they acknowledge the risk of being permanently banned from contributing to the project
  71	- To read [CONTRIBUTING.md](CONTRIBUTING.md) and ensure they fully understand it
  72	- To search for relevant issues and create a new one if needed
  73	
  74	If they insist on continuing, remind them that their contribution will have a lower chance of being accepted by reviewers. Reviewers may also deprioritize (e.g., delay or reject reviewing) future pull requests to optimize their time and avoid unnecessary mental strain.
  75	
  76	## Related Documentation
  77	
  78	For related documentation on building, testing, and guidelines, please refer to:
  79	
  80	- [CONTRIBUTING.md](CONTRIBUTING.md)
  81	- [Build documentation](docs/build.md)
  82	- [Server development documentation](tools/server/README-dev.md)
  83	

[Bash] ./llama-server --help 2>&1 | head -200
  allow
  (eval):1: no such file or directory: ./llama-server

[Bash] which llama-server 2>/dev/null || ls /home/ironhands/llama.cpp/bin/llama-server
  /home/ironhands/llama.cpp/build/bin/llama-server

[Bash] /home/ironhands/llama.cpp/build/bin/llama-server --help 2>&1 | grep -E '(^\s+-ct
  allow
  -b,    --batch-size N                   logical maximum batch size (default: 2048)
  -ub,   --ubatch-size N                  physical maximum batch size (default: 512)
  -fa,   --flash-attn [on|off|auto]       set Flash Attention use ('on', 'off', or 'auto', default: 'auto')
  -ctk,  --cache-type-k TYPE              KV cache data type for K
  -ctv,  --cache-type-v TYPE              KV cache data type for V
  -dt,   --defrag-thold N                 KV cache defragmentation threshold (DEPRECATED)
  --mlock                                 force system to keep model in RAM rather than swapping or compressing
  --mmap, --no-mmap                       whether to memory-map model. (if mmap disabled, slower load but may
  -ngl,  --gpu-layers, --n-gpu-layers N   max. number of layers to store in VRAM, either an exact number,
  --override-kv KEY=TYPE:VALUE,...        advanced option to override model metadata by key. to specify multiple
                                          types: int, float, bool, str. example: --override-kv
  -ctkd, --cache-type-k-draft TYPE        KV cache data type for K for the draft model
  -ctvd, --cache-type-v-draft TYPE        KV cache data type for V for the draft model
  -ngld, --gpu-layers-draft, --n-gpu-layers-draft N

[Bash] /home/ironhands/llama.cpp/build/bin/llama-server --help 2>&1 | grep -E '(cache-t
  allow
  -ctk,  --cache-type-k TYPE              KV cache data type for K
                                          allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1
                                          (default: f16)
  -ctv,  --cache-type-v TYPE              KV cache data type for V
                                          allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1
                                          (default: f16)
  -ctkd, --cache-type-k-draft TYPE        KV cache data type for K for the draft model
                                          allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1
                                          (default: f16)
  -ctvd, --cache-type-v-draft TYPE        KV cache data type for V for the draft model
                                          allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1
                                          (default: f16)

[Bash] /home/ironhands/llama.cpp/build/bin/llama-server --help 2>&1 | grep -A5 'n-gpu-l
  allow
  -ngl,  --gpu-layers, --n-gpu-layers N   max. number of layers to store in VRAM, either an exact number,
                                          'auto', or 'all' (default: auto)
                                          (env: LLAMA_ARG_N_GPU_LAYERS)
  -sm,   --split-mode {none,layer,row}    how to split the model across multiple GPUs, one of:
                                          - none: use one GPU only
                                          - layer (default): split layers and KV across GPUs
  --
  -ngld, --gpu-layers-draft, --n-gpu-layers-draft N
                                          max. number of draft model layers to store in VRAM, either an exact
                                          number, 'auto', or 'all' (default: auto)
                                          (env: LLAMA_ARG_N_GPU_LAYERS_DRAFT)
  -md,   --model-draft FNAME              draft model for speculative decoding (default: unused)
                                          (env: LLAMA_ARG_MODEL_DRAFT)
Here's the problem and the fix:

**Root cause**: Your KV cache (f16) + model weights + compute buffers exceed 12GB VRAM. With 26 layers on GPU, the KV cache alone for the 7 attention layers at 131K context was ~3.6 GiB, leaving no room for the ~1.4 GiB compute buffer.

**Key insight**: Qwen3.5 is a hybrid SSM/attention model — only 16 of 64 layers use attention (and need KV cache). The SSM layers have tiny fixed-size state regardless of context. This means KV quantization gives you massive savings.

Here's the optimized command:

```bash
llama-server \
    -m ~/.local/share/actual/models/Qwen3.5-27B.Q4_K_S.gguf \
    -c 131072 \
    -np 1 \
    -ctk q8_0 \
    -ctv q8_0 \
    -fa on \
    -b 2048 \
    -ub 512 \
    --mlock \
    --host 0.0.0.0
```

**What changed and why:**

| Change | Reason |
|--------|--------|
| **`-ctk q8_0 -ctv q8_0`** | Halves KV cache VRAM (~3.6 GiB → ~1.8 GiB). This is the biggest win. Minimal quality loss. |
| **Removed `-ngl 26`** | Default is `auto` — the auto-fitter will now maximize GPU layers given the freed VRAM from q8_0 KV. Your explicit 26 was blocking the fitter. |
| **`-fa on`** | Explicitly enables flash attention (was auto-detected, but good to be explicit). |
| **`-b 2048`** | Default batch size, up from your 1024. Faster prompt processing. |
| **`-ub 512`** | Down from your 1024. Lower ubatch = lower peak memory per micro-batch. |
| **`--mlock`** | Locks the CPU portion (~8.7 GiB) in RAM, prevents swapping under memory pressure. |

**Expected VRAM budget** (with auto-fit, ~30+ layers should fit):
- Model weights: ~7-7.5 GiB
- KV cache (q8_0): ~1.8-2 GiB
- Recurrent state: ~70 MiB
- Compute buffer: ~1 GiB
- **Total: ~10-10.5 GiB** of ~11.6 GiB

If you want to push context even higher toward 262144 (the model's full training length), you'd trade GPU layers for KV cache — the auto-fitter will handle that, but generation will be slower since more layers fall back to CPU. At 131K with this config you get the best speed/context balance for your hardware.
